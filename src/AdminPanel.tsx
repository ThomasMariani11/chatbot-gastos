import { Icon } from './Icons';
import { BotOperations } from './BotOperations';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { RenewalSender, renewalError, type RenewalAttempt } from './subscriptionRenewals';
import { clientSubscriptionMetrics } from './subscription';
import { useSwipeBack } from './useSwipeBack';

type ClientProfile = {
  id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: 'admin' | 'client';
  subscription_status: 'active' | 'expired' | 'suspended' | 'pending_code';
  subscription_until: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
};

type InvitationCode = {
  id: string;
  code: string;
  duration_days: number | null;
  is_used: boolean;
  used_by: string | null;
  used_at: string | null;
  created_by: string | null;
  notes: string | null;
  created_at: string;
};

type Props = {
  userId: string;
  onBack: () => void;
  onSignOut: () => void;
};

function generateRandomCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const yearSuffix = new Date().getFullYear();
  return `PESO-${rand}-${yearSuffix}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Sin vencimiento';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

function formatShortDate(dateStr: string | null, nowYear = new Date().getFullYear()): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const parts = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace('.', '').toLowerCase();
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? nowYear);
  return year !== nowYear ? `${day} ${month} ${year}` : `${day} ${month}`;
}

function formatClientExpiration(
  untilStr: string | null,
  status: ClientProfile['subscription_status'],
  nowMs: number,
): { label: string; tone: 'neutral' | 'warning' | 'danger' } {
  if (!untilStr) {
    return { label: 'Sin vencimiento', tone: 'neutral' };
  }
  const untilMs = new Date(untilStr).getTime();
  const diffDays = Math.ceil((untilMs - nowMs) / 86400000);
  const shortDate = formatShortDate(untilStr, new Date(nowMs).getFullYear());

  if (status === 'expired' || diffDays <= 0) {
    const daysAgo = Math.abs(diffDays);
    return {
      label:
        daysAgo === 0
          ? `Venció hoy (${shortDate})`
          : `Venció ${shortDate} · hace ${daysAgo} ${daysAgo === 1 ? 'día' : 'días'}`,
      tone: 'danger',
    };
  }
  if (diffDays <= 7) {
    return {
      label: `Vence ${shortDate} · en ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`,
      tone: 'warning',
    };
  }
  return {
    label: `Vence ${shortDate} · en ${diffDays} días`,
    tone: 'neutral',
  };
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Sin vincular';
  if (phone.startsWith('549')) {
    return `+54 9 ${phone.slice(3, 5)} ${phone.slice(5, 9)}-${phone.slice(9)}`;
  }
  return `+${phone}`;
}

export function AdminPanel({ userId, onBack, onSignOut }: Props) {
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [botRefreshTick, setBotRefreshTick] = useState(0);

  // Tabs y Filtros
  const [activeTab, setActiveTab] = useState<'clients' | 'codes' | 'bot' | 'settings'>('clients');
  const [clientSearch, setClientSearch] = useState('');
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [codeFilter, setCodeFilter] = useState<'all' | 'available' | 'used'>('all');

  // Formulario Generador
  const [durationDays, setDurationDays] = useState<number | 'lifetime'>(30);
  const [clientNote, setClientNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Configuración de WhatsApp Bot
  const [botPhone, setBotPhone] = useState('');
  const [savingBotPhone, setSavingBotPhone] = useState(false);
  const [botPhoneSuccess, setBotPhoneSuccess] = useState<string | null>(null);

  // Soporte y datos de cobro para renovaciones
  const [supportPhone, setSupportPhone] = useState('');
  const [paymentAlias, setPaymentAlias] = useState('');
  const [savingSupportConfig, setSavingSupportConfig] = useState(false);
  const [supportConfigSuccess, setSupportConfigSuccess] = useState<string | null>(null);

  // Corte general del bot (exclusivo admin)
  const [botActive, setBotActive] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const [botStatusFeedback, setBotStatusFeedback] = useState<string | null>(null);
  const [confirmingBotPause, setConfirmingBotPause] = useState(false);

  // Modales interactivos (Extender Días y Pausar/Reactivar)
  const [extendingClient, setExtendingClient] = useState<ClientProfile | null>(null);
  const [selectedDaysOption, setSelectedDaysOption] = useState<number | 'lifetime' | 'custom'>(30);
  const [customDays, setCustomDays] = useState<number>(30);
  const [isSubmittingExtend, setIsSubmittingExtend] = useState(false);
  const renewalSender=useMemo(()=>new RenewalSender(userId),[userId]);
  const [pendingRenewal,setPendingRenewal]=useState<RenewalAttempt|null>(null);
  const [renewalStorageIssue,setRenewalStorageIssue]=useState('');
  const renewalMounted=useRef(false);
  useEffect(()=>{renewalMounted.current=true;renewalSender.activate();try{setPendingRenewal(renewalSender.pending());setRenewalStorageIssue('');}catch(error){setRenewalStorageIssue(renewalError(error));}return()=>{renewalMounted.current=false;renewalSender.deactivate();};},[renewalSender]);

  const [suspendingClient, setSuspendingClient] = useState<ClientProfile | null>(null);
  const [isSubmittingSuspend, setIsSubmittingSuspend] = useState(false);

  const [actionToast, setActionToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Gesto táctil swipe back para volver deslizando la pantalla
  const { dragOffset, isSwiping } = useSwipeBack({
    onBack,
    enabled: !extendingClient && !suspendingClient && !confirmingBotPause,
  });

  const modalRef = useRef<HTMLDivElement>(null);
  const modalOpen = Boolean(extendingClient || suspendingClient || confirmingBotPause);
  const modalBusy = isSubmittingExtend || isSubmittingSuspend || togglingBot;

  useEffect(() => {
    if (!modalOpen) return;
    const modal = modalRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalBusy) {
        setExtendingClient(null);
        setSuspendingClient(null);
        setConfirmingBotPause(false);
      }
      if (event.key !== 'Tab' || !modal) return;
      const controls = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [modalOpen, modalBusy]);

  async function loadData() {
    setLoading(true);
    setErrorMsg(null);

    const [profilesRes, codesRes, botPhoneRes, botActiveRes, supportPhoneRes, paymentAliasRes] =
      await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('invitation_codes').select('*').order('created_at', { ascending: false }),
        supabase.from('system_config').select('value').eq('key', 'whatsapp_bot_phone').maybeSingle(),
        supabase.from('system_config').select('value').eq('key', 'bot_active').maybeSingle(),
        supabase.from('system_config').select('value').eq('key', 'support_phone').maybeSingle(),
        supabase.from('system_config').select('value').eq('key', 'payment_alias').maybeSingle(),
      ]);

    if (profilesRes.error) {
      setErrorMsg('No se pudieron cargar los perfiles: ' + profilesRes.error.message);
    } else {
      setProfiles((profilesRes.data ?? []) as ClientProfile[]);
    }

    if (codesRes.error) {
      setErrorMsg(
        (prev) => (prev ? prev + ' | ' : '') + 'No se pudieron cargar los códigos: ' + codesRes.error.message,
      );
    } else {
      setCodes((codesRes.data ?? []) as InvitationCode[]);
    }

    if (botPhoneRes.data?.value) {
      setBotPhone(botPhoneRes.data.value);
    }

    if (supportPhoneRes.data?.value) {
      setSupportPhone(supportPhoneRes.data.value);
    }

    if (paymentAliasRes.data?.value) {
      setPaymentAlias(paymentAliasRes.data.value);
    }

    if (botActiveRes.data?.value !== undefined) {
      setBotActive(botActiveRes.data.value !== 'false');
    }

    setLoading(false);
  }

  async function handleToggleBotActive() {
    setTogglingBot(true);
    setBotStatusFeedback(null);
    const nextActive = !botActive;
    const { error } = await supabase.from('system_config').upsert({
      key: 'bot_active',
      value: String(nextActive),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setErrorMsg('No se pudo cambiar el estado del bot: ' + error.message);
    } else {
      setBotActive(nextActive);
      setConfirmingBotPause(false);
      setBotStatusFeedback(
        nextActive
          ? 'Bot reanudado: todos los clientes pueden enviar gastos.'
          : 'Corte activado: el bot está pausado para los clientes.',
      );
      setTimeout(() => setBotStatusFeedback(null), 4000);
    }
    setTogglingBot(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Métricas
  const now = new Date();
  const clientsOnly = useMemo(() => profiles.filter((p) => p.role === 'client'), [profiles]);

  const { activeClientsCount, expiringSoonCount } = clientSubscriptionMetrics(clientsOnly, now.getTime());

  const availableCodesCount = useMemo(() => {
    return codes.filter((c) => !c.is_used).length;
  }, [codes]);

  // Generar Código
  async function handleCreateCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsGenerating(true);
    setCopyFeedback(null);

    const newCode = generateRandomCode();
    const finalDays = durationDays === 'lifetime' ? null : Number(durationDays);

    const { error } = await supabase.from('invitation_codes').insert({
      code: newCode,
      duration_days: finalDays,
      notes: clientNote.trim() || null,
      created_by: userId,
    });

    setIsGenerating(false);

    if (error) {
      window.alert('Error al generar código: ' + error.message);
      return;
    }

    setGeneratedCode(newCode);
    setClientNote('');
    void loadData();
  }

  function copyOnlyCode(code: string) {
    void navigator.clipboard.writeText(code);
    setCopyFeedback(`¡Código ${code} copiado al portapapeles!`);
    setTimeout(() => setCopyFeedback(null), 3000);
  }

  // Copiar mensaje listo para WhatsApp
  function copyWhatsAppMessage(code: string) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?invitacion=${code}`;
    const text = `¡Hola! Bienvenido/a a *Pesito* 💰✨

Tu cuenta ya está habilitada. Seguí estos 3 pasos rápidos para empezar:

1️⃣ *Creá tu cuenta:* Entrá a este enlace exclusivo:
${inviteUrl}
(Ingresá tu email y la contraseña que prefieras).

2️⃣ *Instalá la app en tu celu (Opcional pero recomendado):*
Tocá el botón *"📲 Instalar app"* arriba a la derecha para tenerla en la pantalla de inicio de tu celular.

3️⃣ *Conectá tu WhatsApp:*
Dentro de la app, andá a *Ajustes* y tocá el botón *"🟢 Conectar mi WhatsApp en un toque"*. Te va a abrir el chat del bot; solo dale a *Enviar* y ¡listo!

🚀 A partir de ese momento podés mandarle audios de voz o textos normales (ej: "gasté 4500 en la carnicería", "me ingresaron 150000") y se registran al instante.`;

    void navigator.clipboard.writeText(text);
    setCopyFeedback('¡Mensaje copiado al portapapeles!');
    setTimeout(() => setCopyFeedback(null), 4000);
  }

  function copyOnlyLink(code: string) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?invitacion=${code}`;
    void navigator.clipboard.writeText(inviteUrl);
    setCopyFeedback('¡Enlace copiado al portapapeles!');
    setTimeout(() => setCopyFeedback(null), 3000);
  }

  // Guardar número de WhatsApp del bot
  async function handleSaveBotPhone(e: FormEvent) {
    e.preventDefault();
    setSavingBotPhone(true);
    setBotPhoneSuccess(null);
    const cleanNumber = botPhone.trim().replace(/[^\d+]/g, '');
    const { error } = await supabase.from('system_config').upsert(
      {
        key: 'whatsapp_bot_phone',
        value: cleanNumber,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );

    setSavingBotPhone(false);
    if (error) {
      window.alert('Error al guardar el número del bot: ' + error.message);
    } else {
      setBotPhone(cleanNumber);
      setBotPhoneSuccess('¡Número del bot guardado exitosamente!');
      setTimeout(() => setBotPhoneSuccess(null), 3500);
    }
  }

  // Guardar configuración de soporte y cobros (renovaciones)
  async function handleSaveSupportConfig(e: FormEvent) {
    e.preventDefault();
    setSavingSupportConfig(true);
    setSupportConfigSuccess(null);
    const cleanSupportNumber = supportPhone.trim().replace(/[^\d+]/g, '');
    const cleanAlias = paymentAlias.trim();

    const [res1, res2] = await Promise.all([
      supabase.from('system_config').upsert(
        {
          key: 'support_phone',
          value: cleanSupportNumber,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      ),
      supabase.from('system_config').upsert(
        {
          key: 'payment_alias',
          value: cleanAlias,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      ),
    ]);

    setSavingSupportConfig(false);
    if (res1.error || res2.error) {
      window.alert(
        'Error al guardar la configuración de soporte: ' + (res1.error?.message || res2.error?.message),
      );
    } else {
      setSupportPhone(cleanSupportNumber);
      setPaymentAlias(cleanAlias);
      setSupportConfigSuccess('¡Configuración de soporte y cobros guardada exitosamente!');
      setTimeout(() => setSupportConfigSuccess(null), 3500);
    }
  }

  // Cálculo dinámico de extensión para el modal
  const extendPreview = useMemo(() => {
    if (!extendingClient) return null;
    if (selectedDaysOption === 'lifetime') {
      return { isLifetime: true, text: 'Plan sin vencimiento' };
    }
    if(extendingClient.subscription_until===null&&['active','suspended'].includes(extendingClient.subscription_status))return {isLifetime:true,text:'Se conserva el acceso sin vencimiento'};
    const days=selectedDaysOption==='custom'?customDays:selectedDaysOption;
    if(!Number.isInteger(days)||days<1||days>3650)return {isLifetime:false,text:'Ingresá de 1 a 3650 días'};
    let baseDate = new Date();
    let isAccumulated = false;
    if (extendingClient.subscription_until) {
      const currentUntil = new Date(extendingClient.subscription_until);
      if (currentUntil > baseDate) {
        baseDate = currentUntil;
        isAccumulated = true;
      }
    }
    const targetDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
    const formatted = new Intl.DateTimeFormat('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(targetDate);

    return {
      isLifetime: false,
      days,
      text: `${formatted} (+${days} ${days === 1 ? 'día' : 'días'}${isAccumulated ? ' acumulados' : ''})`,
    };
  }, [extendingClient, selectedDaysOption, customDays]);

  function handleOpenExtendModal(client: ClientProfile) {
    if(renewalSender.busy)return;
    try{
      const pending=renewalSender.pending();setPendingRenewal(pending);
      if(pending){
        const owner=profiles.find(profile=>profile.id===pending.clientId);
        if(!owner){setActionToast({type:'error',message:'Comprobá la renovación pendiente antes de iniciar otra.'});return;}
        setExtendingClient(owner);setSelectedDaysOption(pending.action==='lifetime'?'lifetime':'custom');setCustomDays(pending.days??30);
      }else{setExtendingClient(client);setSelectedDaysOption(30);setCustomDays(30);}
    }catch(error){setRenewalStorageIssue(renewalError(error));}
  }

  function handleOpenSuspendModal(client: ClientProfile) {
    setSuspendingClient(client);
  }

  async function handleConfirmExtendDays(recover=false) {
    if(renewalSender.busy||renewalStorageIssue||(!extendingClient&&!recover))return;
    setIsSubmittingExtend(true);setActionToast(null);
    try{
      const result=await renewalSender.run(recover||pendingRenewal?undefined:{clientId:extendingClient!.id,action:selectedDaysOption==='lifetime'?'lifetime':'extend',days:selectedDaysOption==='lifetime'?null:selectedDaysOption==='custom'?customDays:selectedDaysOption});
      if(!result||!renewalMounted.current)return;
      setPendingRenewal(null);setExtendingClient(null);
      const until=result.subscription_until===null?'Sin vencimiento':formatDate(result.subscription_until);
      const action=result.replayed?'Renovación comprobada':result.days_added>0?'Se sumaron '+result.days_added+' días':result.subscription_until===null?'Acceso sin vencimiento confirmado':'Renovación completada';
      setActionToast({type:'success',message:action+'. Vencimiento actual: '+until+(result.subscription_status==='suspended'?'. La cuenta sigue pausada.':'.')});void loadData();
    }catch(error){if(renewalMounted.current){setActionToast({type:'error',message:renewalError(error)});try{setPendingRenewal(renewalSender.pending());}catch(storageError){setRenewalStorageIssue(renewalError(storageError));}}}
    finally{if(renewalMounted.current)setIsSubmittingExtend(false);}
  }

  async function handleConfirmToggleSuspend() {
    if (!suspendingClient) return;
    setIsSubmittingSuspend(true);
    setActionToast(null);

    const isCurrentlySuspended = suspendingClient.subscription_status === 'suspended';
    const nextStatus = isCurrentlySuspended ? 'active' : 'suspended';

    const { error } = await supabase
      .from('profiles')
      .update({
        subscription_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', suspendingClient.id);

    setIsSubmittingSuspend(false);

    if (error) {
      setActionToast({ type: 'error', message: 'No se pudo actualizar el estado: ' + error.message });
    } else {
      const msg = isCurrentlySuspended
        ? `Cuenta reactivada para ${suspendingClient.email}.`
        : `Cuenta pausada para ${suspendingClient.email}.`;
      setActionToast({ type: 'success', message: msg });
      setSuspendingClient(null);
      void loadData();
      setTimeout(() => setActionToast(null), 4000);
    }
  }

  // Eliminar código no utilizado
  async function handleDeleteCode(codeItem: InvitationCode) {
    if (codeItem.is_used) {
      window.alert('No podés eliminar un código que ya fue canjeado por un cliente.');
      return;
    }
    const confirm = window.confirm(`¿Anular y borrar el código ${codeItem.code}?`);
    if (!confirm) return;

    const { error } = await supabase.from('invitation_codes').delete().eq('id', codeItem.id);
    if (error) {
      window.alert('Error al borrar código: ' + error.message);
    } else {
      void loadData();
    }
  }

  // Filtros de clientes
  const filteredClients = useMemo(() => {
    return clientsOnly.filter((c) => {
      const q = clientSearch.toLowerCase().trim();
      if (!q) return true;
      const matchesEmail = (c.email ?? '').toLowerCase().includes(q);
      const matchesPhone = (c.phone_number ?? '').includes(q);
      const matchesFirst = (c.first_name ?? '').toLowerCase().includes(q);
      const matchesLast = (c.last_name ?? '').toLowerCase().includes(q);
      const matchesFull = `${c.first_name ?? ''} ${c.last_name ?? ''}`.toLowerCase().includes(q);
      return matchesEmail || matchesPhone || matchesFirst || matchesLast || matchesFull;
    });
  }, [clientsOnly, clientSearch]);

  // Filtros de códigos
  const filteredCodes = useMemo(() => {
    return codes.filter((c) => {
      if (codeFilter === 'available') return !c.is_used;
      if (codeFilter === 'used') return c.is_used;
      return true;
    });
  }, [codes, codeFilter]);

  return (
    <main
      className="admin-page admin-workspace"
      style={
        dragOffset > 0
          ? {
              transform: `translateX(${dragOffset}px)`,
              transition: isSwiping ? 'none' : 'transform 0.18s ease',
              willChange: 'transform',
            }
          : undefined
      }
    >
      {(pendingRenewal||renewalStorageIssue)&&<div className="dashboard-notice" role="status"><p>{renewalStorageIssue||'Tenés una renovación pendiente de comprobar. Conservamos la solicitud para completarla una sola vez.'}</p>{pendingRenewal&&<button type="button" className="button-secondary" disabled={isSubmittingExtend||Boolean(renewalStorageIssue)} onClick={()=>void handleConfirmExtendDays(true)}>{isSubmittingExtend?'Comprobando…':'Comprobar renovación pendiente'}</button>}</div>}
      <header className="admin-header">
        <div className="admin-header-left">
          <button className="back-link button-link" type="button" onClick={onBack}>
            ← Mi cuenta
          </button>
          <div className="admin-title-row">
            <span className="admin-badge">PESITO</span>
            <h1>Administración</h1>
          </div>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-icon-refresh"
            aria-label={loading ? 'Actualizando…' : 'Actualizar datos'}
            title="Actualizar datos"
            onClick={() => {
              setBotRefreshTick((v) => v + 1);
              void loadData();
            }}
            disabled={loading}
          >
            <Icon name="refresh" size={18} />
          </button>
          <button type="button" className="admin-signout-link" onClick={onSignOut}>
            <Icon name="logOut" size={16} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </header>
      {errorMsg && (
        <div className="admin-alert-banner danger" role="alert">
          {errorMsg}
        </div>
      )}
      {actionToast && (
        <div
          className={'admin-alert-banner ' + (actionToast.type === 'error' ? 'danger' : 'success')}
          role={actionToast.type === 'error' ? 'alert' : 'status'}
        >
          {actionToast.message}
        </div>
      )}
      {!loading && !botActive && (
        <div className="admin-alert-banner danger admin-paused-banner">
          <span>Las respuestas del bot están pausadas para todos los clientes.</span>
          <button type="button" className="action-btn small" onClick={() => setActiveTab('bot')}>
            Ir al bot
          </button>
        </div>
      )}
      <nav className="admin-workspace-nav" aria-label="Secciones de administración">
        {(
          [
            ['clients', 'Clientes', loading ? null : clientsOnly.length],
            ['codes', 'Invitaciones', loading ? null : availableCodesCount],
            ['bot', 'Bot', null],
            ['settings', 'Ajustes', null],
          ] as const
        ).map(([tab, label, count]) => (
          <button
            key={tab}
            type="button"
            aria-current={activeTab === tab ? 'page' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            <span>{label}</span>
            {count !== null && <span className="admin-nav-badge">{count}</span>}
          </button>
        ))}
      </nav>
      {activeTab === 'clients' && (
        <>
          <section className="admin-overview" aria-label="Resumen de clientes">
            <div>
              <strong>{loading ? '—' : clientsOnly.length}</strong>
              <span>Clientes</span>
            </div>
            <div>
              <strong>{loading ? '—' : activeClientsCount}</strong>
              <span>Activos</span>
            </div>
            <div className={expiringSoonCount ? 'attention' : ''}>
              <strong>{loading ? '—' : expiringSoonCount}</strong>
              <span>Vencen en 7 días</span>
            </div>
            <div>
              <strong>{loading ? '—' : availableCodesCount}</strong>
              <span>Invitaciones libres</span>
            </div>
          </section>
          <section className="admin-workspace-card" aria-label="Listado de clientes">
            <div className="admin-search-row">
              <label className="admin-search-label">
                <span className="admin-visually-hidden">Buscar cliente</span>
                <span className="admin-search-box">
                  <Icon name="search" size={18} className="admin-search-icon" />
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Buscar nombre, email o WhatsApp"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                  />
                </span>
              </label>
              {clientSearch && (
                <button type="button" className="admin-text-action" onClick={() => setClientSearch('')}>
                  Limpiar
                </button>
              )}
            </div>
            {loading ? (
              <p className="loading-copy" role="status">
                Cargando clientes…
              </p>
            ) : filteredClients.length === 0 ? (
              <div className="empty-state">
                <p>
                  {clientSearch ? 'No hay clientes que coincidan con la búsqueda.' : 'Todavía no hay clientes.'}
                </p>
                {!clientSearch && (
                  <button
                    type="button"
                    className="admin-text-action"
                    onClick={() => {
                      setActiveTab('codes');
                      setShowCodeForm(true);
                    }}
                  >
                    Crear una invitación
                  </button>
                )}
              </div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table admin-responsive-table admin-clients-table">
                  <thead>
                    <tr>
                      <th scope="col">Cliente</th>
                      <th scope="col">WhatsApp</th>
                      <th scope="col">Acceso</th>
                      <th scope="col">Vencimiento</th>
                      <th scope="col" className="admin-th-actions">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => {
                      const isExpired =
                        client.subscription_status === 'expired' ||
                        !!(client.subscription_until && new Date(client.subscription_until) < now);
                      const isExpiringSoon =
                        !isExpired &&
                        client.subscription_until &&
                        (new Date(client.subscription_until).getTime() - now.getTime()) / 86400000 <= 7;
                      const displayName =
                        [client.first_name, client.last_name].filter(Boolean).join(' ') ||
                        client.email ||
                        'Cliente sin nombre';
                      const status =
                        client.subscription_status === 'pending_code'
                          ? { label: 'Sin activar', tone: 'orange' }
                          : client.subscription_status === 'suspended'
                            ? { label: 'Pausado', tone: 'gray' }
                            : isExpired
                              ? { label: 'Vencido', tone: 'red' }
                              : isExpiringSoon
                                ? { label: 'Por vencer', tone: 'orange' }
                                : { label: 'Activo', tone: 'green' };
                      const expiry = formatClientExpiration(
                        client.subscription_until,
                        client.subscription_status,
                        now.getTime(),
                      );
                      return (
                        <tr key={client.id}>
                          <td data-label="Cliente" className="admin-client-cell">
                            <strong>{displayName}</strong>
                            {displayName !== client.email && (
                              <span className="cell-subtext">{client.email || 'Sin email'}</span>
                            )}
                          </td>
                          <td data-label="WhatsApp" className="admin-wa-cell">
                            {client.phone_number ? (
                              <a
                                className="admin-client-phone"
                                href={'https://wa.me/' + client.phone_number}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={'Abrir WhatsApp de ' + displayName}
                              >
                                <Icon name="message" size={15} /> {formatPhone(client.phone_number)}
                              </a>
                            ) : (
                              <span className="admin-muted">Sin vincular</span>
                            )}
                          </td>
                          <td data-label="Acceso" className="admin-access-cell">
                            <span className={'status-pill ' + status.tone}>{status.label}</span>
                          </td>
                          <td data-label="Vencimiento" className="admin-expiry-cell">
                            <span className={'admin-expiry-text ' + expiry.tone}>{expiry.label}</span>
                          </td>
                          <td data-label="Acciones" className="admin-row-actions">
                            <div className="action-buttons-group">
                              <button
                                type="button"
                                className="action-btn small positive"
                                aria-label={'Extender membresía de ' + displayName}
                                onClick={() => handleOpenExtendModal(client)}
                              >
                                Extender
                              </button>
                              <button
                                type="button"
                                className={
                                  'action-btn small ' +
                                  (client.subscription_status === 'suspended' ? 'positive' : 'pause-btn')
                                }
                                aria-label={
                                  (client.subscription_status === 'suspended' ? 'Reactivar a ' : 'Pausar a ') +
                                  displayName
                                }
                                onClick={() => handleOpenSuspendModal(client)}
                              >
                                {client.subscription_status === 'suspended' ? 'Reactivar' : 'Pausar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {activeTab === 'codes' && (
        <section className="admin-workspace-card" aria-labelledby="admin-invitations-title">
          <div className="admin-section-heading">
            <div>
              <h2 id="admin-invitations-title">Invitaciones</h2>
              <p>Un código por cliente para activar su cuenta.</p>
            </div>
            <button
              type="button"
              className={(showCodeForm ? 'button-secondary' : 'primary-button') + ' admin-compact-primary'}
              aria-expanded={showCodeForm}
              aria-controls="admin-new-invitation"
              onClick={() => setShowCodeForm((v) => !v)}
            >
              {showCodeForm ? 'Cerrar formulario' : 'Nueva invitación'}
            </button>
          </div>
          {showCodeForm && (
            <div id="admin-new-invitation" className="admin-invite-form">
              <form onSubmit={handleCreateCode}>
                <div className="form-grid">
                  <label>
                    Duración
                    <select
                      value={durationDays}
                      onChange={(e) =>
                        setDurationDays(e.target.value === 'lifetime' ? 'lifetime' : Number(e.target.value))
                      }
                    >
                      <option value={30}>1 mes · 30 días</option>
                      <option value={90}>3 meses · 90 días</option>
                      <option value={180}>6 meses · 180 días</option>
                      <option value={365}>1 año · 365 días</option>
                      <option value="lifetime">Sin vencimiento</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      Nota interna <span className="admin-muted">(opcional)</span>
                    </span>
                    <input
                      type="text"
                      placeholder="Nombre o referencia del pago"
                      value={clientNote}
                      onChange={(e) => setClientNote(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  className="primary-button admin-compact-primary"
                  disabled={isGenerating || loading}
                >
                  {isGenerating ? 'Creando…' : 'Crear código'}
                </button>
              </form>
            </div>
          )}
          {generatedCode && (
            <div className="generated-code-box">
              <span className="code-label">Invitación lista</span>
              <strong className="code-token">{generatedCode}</strong>
              <div className="code-actions">
                <button
                  type="button"
                  className="action-btn small positive"
                  onClick={() => copyOnlyCode(generatedCode)}
                >
                  <Icon name="copy" size={14} /> Copiar código
                </button>
                <button
                  type="button"
                  className="action-btn small"
                  onClick={() => copyWhatsAppMessage(generatedCode)}
                >
                  Copiar mensaje
                </button>
                <button
                  type="button"
                  className="action-btn small secondary"
                  onClick={() => copyOnlyLink(generatedCode)}
                >
                  Copiar enlace
                </button>
              </div>
            </div>
          )}
          {copyFeedback && (
            <p className="admin-copy-feedback" role="status">
              {copyFeedback}
            </p>
          )}
          <div className="filter-pills admin-code-filters" aria-label="Filtrar invitaciones">
            {(
              [
                ['all', 'Todas', codes.length],
                ['available', 'Disponibles', availableCodesCount],
                ['used', 'Usadas', codes.length - availableCodesCount],
              ] as const
            ).map(([filter, label, count]) => (
              <button
                key={filter}
                type="button"
                aria-pressed={codeFilter === filter}
                className={'pill-btn ' + (codeFilter === filter ? 'active' : '')}
                onClick={() => setCodeFilter(filter)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          {loading ? (
            <p className="loading-copy" role="status">
              Cargando invitaciones…
            </p>
          ) : filteredCodes.length === 0 ? (
            <div className="empty-state">
              <p>No hay invitaciones en este filtro.</p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table admin-responsive-table admin-codes-table">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Duración</th>
                    <th scope="col">Nota</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="admin-th-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCodes.map((item) => (
                    <tr key={item.id} className={item.is_used ? 'is-used-code' : ''}>
                      <td data-label="Código" className="admin-client-cell">
                        <strong className="code-token-sm">{item.code}</strong>
                        <span className="cell-subtext">Creado {formatShortDate(item.created_at, now.getFullYear())}</span>
                      </td>
                      <td data-label="Duración" className="admin-code-duration-cell">
                        {item.duration_days ? item.duration_days + ' días' : 'Sin vencimiento'}
                      </td>
                      <td data-label="Nota" className="admin-code-note-cell">{item.notes || '—'}</td>
                      <td data-label="Estado" className="admin-code-status-cell">
                        <span className={'status-pill ' + (item.is_used ? 'gray' : 'green')}>
                          {item.is_used
                            ? `Usada el ${formatShortDate(item.used_at || item.created_at, now.getFullYear())}`
                            : 'Disponible'}
                        </span>
                      </td>
                      <td data-label="Acciones" className="admin-row-actions">
                        {item.is_used ? (
                          <span className="admin-muted admin-used-dash">—</span>
                        ) : (
                          <div className="action-buttons-group">
                            <button
                              type="button"
                              className="action-btn small positive"
                              aria-label={'Copiar código ' + item.code}
                              onClick={() => copyOnlyCode(item.code)}
                            >
                              <Icon name="copy" size={14} /> Copiar código
                            </button>
                            <button
                              type="button"
                              className="action-btn small"
                              aria-label={'Copiar mensaje de ' + item.code}
                              onClick={() => copyWhatsAppMessage(item.code)}
                            >
                              Mensaje
                            </button>
                            <button
                              type="button"
                              className="action-btn small secondary"
                              aria-label={'Copiar enlace de ' + item.code}
                              onClick={() => copyOnlyLink(item.code)}
                            >
                              Enlace
                            </button>
                            <button
                              type="button"
                              className="action-btn small danger"
                              onClick={() => void handleDeleteCode(item)}
                            >
                              Anular
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {activeTab === 'bot' && (
        <div className="admin-bot-view">
          <BotOperations key={`${userId}-${botRefreshTick}`} />
          <section className="admin-workspace-card" aria-labelledby="admin-bot-control-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="admin-bot-control-title">Respuestas a clientes</h2>
                <p>
                  {botActive
                    ? 'El bot está habilitado para atender a tus clientes.'
                    : 'Las respuestas están pausadas para todos los clientes.'}
                </p>
              </div>
              <span className={'status-pill ' + (botActive ? 'green' : 'red')}>
                {botActive ? 'Habilitadas' : 'En pausa'}
              </span>
            </div>
            <button
              type="button"
              className={(botActive ? 'danger-button' : 'primary-button') + ' admin-compact-primary'}
              disabled={togglingBot || loading}
              onClick={() => {
                if (botActive) {
                  setConfirmingBotPause(true);
                } else {
                  void handleToggleBotActive();
                }
              }}
            >
              {togglingBot ? 'Guardando…' : botActive ? 'Pausar bot' : 'Reanudar bot'}
            </button>
            {botStatusFeedback && (
              <p className="admin-copy-feedback" role="status">
                {botStatusFeedback}
              </p>
            )}
          </section>
        </div>
      )}
      {activeTab === 'settings' && (
        <section className="admin-workspace-card" aria-labelledby="admin-settings-title">
          <div className="admin-section-heading">
            <div>
              <h2 id="admin-settings-title">Ajustes</h2>
              <p>Conexión del bot, soporte y cobros.</p>
            </div>
          </div>
          <details className="admin-settings-group">
            <summary>
              <span className="admin-summary-label">WhatsApp del bot</span>
              <span className="admin-summary-right">
                <span className="admin-summary-hint">Ver y editar</span>
                <Icon name="chevronDown" size={18} className="admin-summary-chevron" />
              </span>
            </summary>
            <form onSubmit={handleSaveBotPhone} className="generator-form">
              <label>
                Número del bot
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="Ej. 15551234567"
                  value={botPhone}
                  onChange={(e) => setBotPhone(e.target.value)}
                />
              </label>
              <p className="admin-field-hint">Incluí el código de país.</p>
              <div className="admin-form-actions">
                <button
                  className="primary-button admin-compact-primary"
                  type="submit"
                  disabled={savingBotPhone || loading}
                >
                  {savingBotPhone ? 'Guardando…' : 'Guardar número'}
                </button>
                {botPhone && (
                  <a
                    className="admin-text-action"
                    href={'https://wa.me/' + botPhone.replace(/\D/g, '')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir chat ↗
                  </a>
                )}
              </div>
              {botPhoneSuccess && (
                <p className="admin-copy-feedback" role="status">
                  {botPhoneSuccess}
                </p>
              )}
            </form>
          </details>
          <details className="admin-settings-group">
            <summary>
              <span className="admin-summary-label">Soporte y cobros</span>
              <span className="admin-summary-right">
                <span className="admin-summary-hint">Ver y editar</span>
                <Icon name="chevronDown" size={18} className="admin-summary-chevron" />
              </span>
            </summary>
            <form onSubmit={handleSaveSupportConfig} className="generator-form">
              <div className="form-grid">
                <label>
                  WhatsApp de soporte
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="Con código de país"
                    value={supportPhone}
                    onChange={(e) => setSupportPhone(e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Alias o CBU <span className="admin-muted">(opcional)</span>
                  </span>
                  <input
                    type="text"
                    placeholder="Alias para transferencias"
                    value={paymentAlias}
                    onChange={(e) => setPaymentAlias(e.target.value)}
                  />
                </label>
              </div>
              <div className="admin-form-actions">
                <button
                  className="primary-button admin-compact-primary"
                  type="submit"
                  disabled={savingSupportConfig || loading}
                >
                  {savingSupportConfig ? 'Guardando…' : 'Guardar ajustes'}
                </button>
                {supportPhone && (
                  <a
                    className="admin-text-action"
                    href={'https://wa.me/' + supportPhone.replace(/\D/g, '')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir soporte ↗
                  </a>
                )}
              </div>
              {supportConfigSuccess && (
                <p className="admin-copy-feedback" role="status">
                  {supportConfigSuccess}
                </p>
              )}
            </form>
          </details>
        </section>
      )}

      {/* MODAL: CONFIRMAR PAUSAR BOT */}
      {confirmingBotPause && (
        <div
          className="admin-modal-backdrop"
          onClick={() => !togglingBot && setConfirmingBotPause(false)}
        >
          <div
            className="admin-modal-card"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-pause-bot-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <div>
                <h3 id="admin-pause-bot-title">Pausar respuestas del bot</h3>
                <p>Corte general para todos los clientes</p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                aria-label="Cerrar"
                disabled={togglingBot}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setConfirmingBotPause(false)}
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="admin-date-preview-card danger">
              <span className="preview-label">Efecto de la pausa</span>
              <p style={{ margin: '4px 0 0', fontSize: '13px', lineHeight: 1.5, color: '#334155' }}>
                Mientras el bot esté en pausa, ningún cliente recibirá respuestas automáticas por WhatsApp. Podés reanudarlo en cualquier momento.
              </p>
            </div>

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-btn-cancel"
                disabled={togglingBot}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setConfirmingBotPause(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={togglingBot}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleToggleBotActive()}
              >
                {togglingBot ? 'Guardando…' : 'Pausar bot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EXTENDER DÍAS DE SUSCRIPCIÓN */}
      {extendingClient && (
        <div className="admin-modal-backdrop" onClick={() => !isSubmittingExtend && setExtendingClient(null)}>
          <div
            className="admin-modal-card"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-membership-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <div>
                <h3 id="admin-membership-title">Extender membresía</h3>
                <p>
                  <strong>
                    {[extendingClient.first_name, extendingClient.last_name].filter(Boolean).join(' ')
                      ? [extendingClient.first_name, extendingClient.last_name].filter(Boolean).join(' ')
                      : extendingClient.email}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                aria-label="Cerrar"
                disabled={isSubmittingExtend}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setExtendingClient(null)}
              >
                <Icon name="close" />
              </button>
            </div>

            <div>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#475569',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                Elegí cuánto tiempo querés sumar:
              </span>
              <div className="admin-days-grid">
                {[
                  { value: 15, label: '+15 días', desc: 'Quincena' },
                  { value: 30, label: '+30 días', desc: '1 Mes' },
                  { value: 60, label: '+60 días', desc: '2 Meses' },
                  { value: 90, label: '+90 días', desc: '3 Meses (Trimestre)' },
                  { value: 180, label: '+180 días', desc: '6 Meses (Semestre)' },
                  { value: 365, label: '+365 días', desc: '1 Año' },
                  { value: 'lifetime', label: 'Sin vencimiento', desc: 'Acceso permanente' },
                  { value: 'custom', label: 'Otra duración', desc: 'Elegir días' },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className={`admin-day-chip ${selectedDaysOption === opt.value ? 'active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={isSubmittingExtend || Boolean(pendingRenewal) || Boolean(renewalStorageIssue)}
                    onClick={() => setSelectedDaysOption(opt.value as number | 'lifetime' | 'custom')}
                  >
                    <span>{opt.label}</span>
                    <small>{opt.desc}</small>
                  </button>
                ))}
              </div>

              {selectedDaysOption === 'custom' && (
                <div className="admin-custom-days-row">
                  <label>
                    Cantidad exacta de días:
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      disabled={isSubmittingExtend || Boolean(pendingRenewal) || Boolean(renewalStorageIssue)}
                      className="admin-custom-days-input"
                      value={customDays}
                      onChange={(e) => setCustomDays(Number(e.target.value))}
                    />
                    <span>días</span>
                  </label>
                </div>
              )}
            </div>

            {actionToast?.type==='error'&&<p role="alert">{actionToast.message}</p>}
            {pendingRenewal&&<p role="status">Solicitud original: {pendingRenewal.action==='lifetime'?'sin vencimiento':pendingRenewal.days+' días'}. Comprobarla no vuelve a sumar días.</p>}
            {renewalStorageIssue&&<p role="alert">{renewalStorageIssue}</p>}
            {extendPreview && !pendingRenewal && (
              <div className="admin-date-preview-card">
                <span className="preview-label">Vencimiento estimado</span>
                <strong className="preview-value">{extendPreview.text}</strong>
                <small style={{ color: '#047857', fontSize: '13px', marginTop: '2px' }}>
                  Vencimiento actual: {formatDate(extendingClient.subscription_until)}. El servidor confirma la fecha.
                </small>
              </div>
            )}

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-btn-cancel"
                disabled={isSubmittingExtend}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setExtendingClient(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={isSubmittingExtend || Boolean(renewalStorageIssue) || (!pendingRenewal && selectedDaysOption!=='lifetime' && (!Number.isInteger(selectedDaysOption==='custom'?customDays:selectedDaysOption) || (selectedDaysOption==='custom'?customDays:selectedDaysOption)<1 || (selectedDaysOption==='custom'?customDays:selectedDaysOption)>3650))}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleConfirmExtendDays()}
              >
                {isSubmittingExtend ? 'Comprobando…' : pendingRenewal ? 'Comprobar renovación' : selectedDaysOption==='lifetime'?'Confirmar sin vencimiento':'Confirmar y sumar días'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PAUSAR / REACTIVAR CUENTA */}
      {suspendingClient && (
        <div
          className="admin-modal-backdrop"
          onClick={() => !isSubmittingSuspend && setSuspendingClient(null)}
        >
          <div
            className="admin-modal-card"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-access-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <div>
                <h3 id="admin-access-title">
                  {suspendingClient.subscription_status === 'suspended'
                    ? 'Reactivar cuenta'
                    : 'Pausar cuenta'}
                </h3>
                <p>
                  Cliente:{' '}
                  <strong>
                    {[suspendingClient.first_name, suspendingClient.last_name].filter(Boolean).join(' ')
                      ? [suspendingClient.first_name, suspendingClient.last_name].filter(Boolean).join(' ')
                      : suspendingClient.email}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                aria-label="Cerrar"
                disabled={isSubmittingSuspend}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSuspendingClient(null)}
              >
                <Icon name="close" />
              </button>
            </div>

            <div
              className={`admin-date-preview-card ${suspendingClient.subscription_status === 'suspended' ? '' : 'danger'}`}
            >
              <span className="preview-label">
                {suspendingClient.subscription_status === 'suspended'
                  ? 'Efecto de la reactivación'
                  : 'Efecto de la pausa'}
              </span>
              <p style={{ margin: '4px 0 0', fontSize: '13px', lineHeight: 1.5, color: '#334155' }}>
                {suspendingClient.subscription_status === 'suspended'
                  ? 'Se levantará la pausa. El acceso dependerá de la vigencia de su membresía.'
                  : 'El cliente no podrá registrar movimientos mientras su cuenta esté pausada. Podés reactivarlo después.'}
              </p>
            </div>

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-btn-cancel"
                disabled={isSubmittingSuspend}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSuspendingClient(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={
                  suspendingClient.subscription_status === 'suspended' ? 'primary-button' : 'danger-button'
                }
                disabled={isSubmittingSuspend}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleConfirmToggleSuspend()}
              >
                {isSubmittingSuspend
                  ? 'Guardando…'
                  : suspendingClient.subscription_status === 'suspended'
                    ? 'Reactivar cuenta'
                    : 'Pausar cuenta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
