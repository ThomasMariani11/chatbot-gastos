import { Icon } from './Icons';
import {
  filterMovementsList,
  groupMovementsByDay,
  nextScheduledInstallment,
  normalizeDashboardSection,
  summarizeMonthlyInstallments,
} from './summaryPresentation';
import { categoryVisual, movementVisual } from './categoryVisuals';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { supabase } from './supabase';
import { requestWhatsAppLinkCode } from './whatsappLink';
import { installmentDate, formatAmountInput, numberToAmountInput, parseAmountNumber, formatMoney } from '../lib/finance';
import { usePwaInstall } from './usePwaInstall';
import { InstallAppModal } from './InstallAppModal';
import type { UserProfile } from './Settings';

type Movement = {
  id: string;
  title: string;
  category: string;
  categoryId?: string;
  amount: number;
  currency: 'ARS' | 'USD';
  date: string;
  kind: 'expense' | 'income';
  installmentNumber?: number | null;
  installmentCount?: number | null;
  installmentGroupId?: string | null;
};


type CategoryOption = {
  id: string;
  name: string;
  kind: 'expense' | 'income';
};

type BotState = 'active' | 'paused' | 'unlinked' | 'cost-blocked' | 'loading' | 'unknown';

type InstallmentPlan = {
  groupId: string;
  description: string;
  totalAmount: number;
  currency: 'ARS' | 'USD';
  installmentCount: number;
  vanCount: number;
  monthlyAmount: number;
  quedanCount: number;
  quedanTotal: number;
  progressPercent: number;
  currentDateStr: string;
  nextScheduled?: Movement;
  currentMovement?: Movement;
};

type Props = {
  userId: string;
  userEmail?: string | null;
  userProfile?: UserProfile | null;
  onOpenSettings: () => void;
  onSignOut: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
};


function formatMovementDate(dateStr: string) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-').map(Number);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const monthAbbr = months[(m - 1) % 12];
  return `${d} ${monthAbbr}`;
}

function formatScheduledDate(dateStr: string) {
  const year = dateStr.slice(0, 4);
  return formatMovementDate(dateStr) + (year !== todayKey().slice(0, 4) ? ` ${year}` : '');
}

function monthKey(date: Date) {

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key: string, offset: number) {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(year, month - 1 + offset, 1));
}

function splitInstallments(total: number, count: number) {
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index === count - 1 ? remainder : 0)) / 100);
}


function labelForMonth(key: string) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(date);
  return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

function IconHome({ className = 'nav-icon' }: { className?: string }) { return <Icon name="home" className={className} />; }
function IconMovements({ className = 'nav-icon' }: { className?: string }) { return <Icon name="movements" className={className} />; }
function IconInstallments({ className = 'nav-icon' }: { className?: string }) { return <Icon name="card" className={className} />; }
function IconSettings({ className = 'nav-icon' }: { className?: string }) { return <Icon name="settings" className={className} />; }

const PRESET_INSTALLMENT_COUNTS = [2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36, 48];

export function Dashboard({ userId, userEmail, userProfile, onOpenSettings, onSignOut, isAdmin, onOpenAdmin }: Props) {
  // Solo el primer nombre para el saludo de bienvenida ("Hola, María 👋")
  const firstName = useMemo(() => {
    if (userProfile?.first_name?.trim()) {
      return userProfile.first_name.trim();
    }
    if (!userEmail) return 'Thomas';
    const namePart = userEmail.split('@')[0];
    const words = namePart.replace(/[._-]/g, ' ').trim().split(/\s+/);
    return words[0].charAt(0).toUpperCase() + words[0].slice(1);
  }, [userProfile?.first_name, userEmail]);

  // Nombre completo para la barra lateral y datos de cuenta
  const userDisplayName = useMemo(() => {
    if (userProfile?.first_name?.trim() || userProfile?.last_name?.trim()) {
      return [userProfile.first_name?.trim(), userProfile.last_name?.trim()].filter(Boolean).join(' ');
    }
    if (!userEmail) return 'Thomas';
    const namePart = userEmail.split('@')[0];
    const words = namePart.replace(/[._-]/g, ' ').trim().split(/\s+/);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }, [userProfile?.first_name, userProfile?.last_name, userEmail]);

  const userInitials = useMemo(() => {
    if (userProfile?.first_name?.trim() && userProfile?.last_name?.trim()) {
      return (userProfile.first_name.trim()[0] + userProfile.last_name.trim()[0]).toUpperCase();
    }
    if (!userDisplayName) return 'TS';
    const parts = userDisplayName.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return userDisplayName.slice(0, 2).toUpperCase();
  }, [userProfile?.first_name, userProfile?.last_name, userDisplayName]);

  // PWA Install hook
  const {
    canInstall,
    triggerInstall,
    showIosModal,
    setShowIosModal,
    showDesktopModal,
    setShowDesktopModal,
  } = usePwaInstall();

  // Onboarding WhatsApp (Fase 4)
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [onboardingWaMsg, setOnboardingWaMsg] = useState<string | null>(null);
  const [waBotNumber, setWaBotNumber] = useState<string>('');
  const [waLinkReady, setWaLinkReady] = useState<{ url: string; code: string } | null>(null);

  async function handleConnectWhatsApp() {
    setIsConnectingWa(true);
    setOnboardingWaMsg(null);

    try {
      const { code: nextCode } = await requestWhatsAppLinkCode();

      let targetPhone = waBotNumber;
      if (!targetPhone) {
        const { data: configData } = await supabase
          .from('system_config')
          .select('value')
          .eq('key', 'whatsapp_bot_phone')
          .maybeSingle();
        if (configData?.value) {
          targetPhone = configData.value;
          setWaBotNumber(configData.value);
        }
      }

      const cleanPhone = (targetPhone || '').replace(/\D/g, '');
      const waUrl = cleanPhone
        ? `https://wa.me/${cleanPhone}?text=VINCULAR%20${nextCode}`
        : `https://wa.me/?text=VINCULAR%20${nextCode}`;

      setWaLinkReady({ url: waUrl, code: nextCode });
      setIsConnectingWa(false);
      setOnboardingWaMsg(
        `⏳ Generamos tu código (VINCULAR ${nextCode}). Tocá 'Enviar' en el chat con Pesito. Tu pantalla se actualizará automáticamente apenas lo envíes.`
      );

      // En móviles o PWAs, window.open tras una promesa async es bloqueado como popup por Safari/Chrome.
      // Modificar window.location.href abre directamente el Universal Link de WhatsApp de forma nativa.
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.matchMedia('(display-mode: standalone)').matches;
      if (isMobile) {
        window.location.href = waUrl;
      } else {
        const win = window.open(waUrl, '_blank');
        if (!win) {
          window.location.href = waUrl;
        }
      }
    } catch {
      setIsConnectingWa(false);
      setOnboardingWaMsg('Ocurrió un inconveniente al abrir WhatsApp.');
    }
  }

  const currentMonth = monthKey(new Date());
  const [month, setMonth] = useState(currentMonth);
  const [knownMonths, setKnownMonths] = useState<string[]>([]);
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();

    // Incluimos siempre el mes actual del calendario (ej. Septiembre 2026)
    if (currentMonth) monthsSet.add(currentMonth);

    // Incluimos siempre el mes que el usuario está consultando en pantalla
    if (month) monthsSet.add(month);

    // Incluimos todos los meses que tengan gastos/movimientos o cuotas registradas
    knownMonths.forEach((m) => {
      if (m && /^\d{4}-\d{2}$/.test(m)) monthsSet.add(m);
    });

    return Array.from(monthsSet).sort();
  }, [currentMonth, month, knownMonths]);

  const [activeSection, setActiveSection] = useState(() => normalizeDashboardSection(window.location.hash));
  useEffect(() => {
    const syncSection = () => {
      setActiveSection(normalizeDashboardSection(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', syncSection);
    window.addEventListener('popstate', syncSection);
    return () => {
      window.removeEventListener('hashchange', syncSection);
      window.removeEventListener('popstate', syncSection);
    };
  }, []);
  const [movementSearch, setMovementSearch] = useState('');
  const [movementKindFilter, setMovementKindFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [movementCategoryFilter, setMovementCategoryFilter] = useState('all');
  const [openInstallmentMenuId, setOpenInstallmentMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!openInstallmentMenuId) return;
    const closeMenu = () => setOpenInstallmentMenuId(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenInstallmentMenuId(null);
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openInstallmentMenuId]);

  const [activeCurrency, setActiveCurrency] = useState<'ARS' | 'USD'>('ARS');
  const [manualCurrency, setManualCurrency] = useState<'ARS' | 'USD'>('ARS');
  const [editCurrency, setEditCurrency] = useState<'ARS' | 'USD'>('ARS');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [installmentPlans, setInstallmentPlans] = useState<InstallmentPlan[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [budget, setBudget] = useState(0);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showDeleteBudgetConfirm, setShowDeleteBudgetConfirm] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [expandedCategoryInModal, setExpandedCategoryInModal] = useState<string | null>(null);
  const [dashboardActiveCategory, setDashboardActiveCategory] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [botState, setBotState] = useState<BotState>('loading');
  const [showAdd, setShowAdd] = useState(false);
  const [manualKind, setManualKind] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [isInstallments, setIsInstallments] = useState(false);
  const [installmentCount, setInstallmentCount] = useState(3);
  const [isCustomInstallmentCount, setIsCustomInstallmentCount] = useState(false);
  const [customCountInput, setCustomCountInput] = useState('3');
  const [installmentAmountMode, setInstallmentAmountMode] = useState<'total' | 'quota'>('total');
  const [currentInstallmentNumber, setCurrentInstallmentNumber] = useState<number>(1);
  const [formAmount, setFormAmount] = useState<string>('');
  const [installmentDeletePrompt, setInstallmentDeletePrompt] = useState<{ movement?: Movement; plan?: InstallmentPlan } | null>(null);
  const [editingMovement, setEditingMovement] = useState<Movement | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editAmount, setEditAmount] = useState<string>('');
  const [editKind, setEditKind] = useState<'expense' | 'income'>('expense');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editInstallmentNumber, setEditInstallmentNumber] = useState<number>(1);
  const [editInstallmentCount, setEditInstallmentCount] = useState<number>(3);
  const [isCustomEditInstallmentCount, setIsCustomEditInstallmentCount] = useState(false);
  const [customEditCountInput, setCustomEditCountInput] = useState('3');
  const [editApplyToAll, setEditApplyToAll] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const availableCategories = useMemo(() => categories.filter((category) => category.kind === manualKind), [categories, manualKind]);
  const availableEditCategories = useMemo(() => categories.filter((category) => category.kind === editKind), [categories, editKind]);

  const filteredMovements = useMemo(() => {
    return movements.filter((item) => (item.currency || 'ARS') === activeCurrency);
  }, [movements, activeCurrency]);

  const filteredInstallmentPlans = useMemo(() => {
    return installmentPlans.filter((plan) => (plan.currency || 'ARS') === activeCurrency);
  }, [installmentPlans, activeCurrency]);

  const visibleMovements = filteredMovements.slice(0, 5);
  const upcomingPlans = filteredInstallmentPlans.filter(plan => plan.nextScheduled);

  const movementCategoryOptions = useMemo(() => {
    const names = new Set<string>();
    filteredMovements.forEach((item) => {
      if (item.category) names.add(item.category);
    });
    categories.forEach((cat) => {
      if (movementKindFilter === 'all' || cat.kind === movementKindFilter) {
        names.add(cat.name);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'es'));
  }, [filteredMovements, categories, movementKindFilter]);

  const searchedMovements = useMemo(
    () =>
      filterMovementsList(filteredMovements, {
        query: movementSearch,
        kind: movementKindFilter,
        category: movementCategoryFilter,
      }),
    [filteredMovements, movementSearch, movementKindFilter, movementCategoryFilter],
  );

  const groupedMovementsByDay = useMemo(
    () => groupMovementsByDay(searchedMovements, todayKey()),
    [searchedMovements],
  );

  const hasActiveMovementFilters =
    movementSearch.trim().length > 0 || movementKindFilter !== 'all' || movementCategoryFilter !== 'all';

  const installmentsSummary = useMemo(
    () => summarizeMonthlyInstallments(filteredMovements, filteredInstallmentPlans.length),
    [filteredMovements, filteredInstallmentPlans.length],
  );

  const expenses = useMemo(() => filteredMovements.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0), [filteredMovements]);
  const income = useMemo(() => filteredMovements.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0), [filteredMovements]);
  const progress = budget > 0 ? Math.round((expenses / budget) * 100) : 0;
  const chartData = useMemo(() => {
    const grouped = new Map<string, number>();
    filteredMovements
      .filter((item) => item.kind === 'expense')
      .forEach((item) => grouped.set(item.category, (grouped.get(item.category) ?? 0) + item.amount));
    return Array.from(grouped, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredMovements]);

  const botStatus = {
    active: { title: 'Bot habilitado', detail: 'WhatsApp activo' },
    paused: { title: 'Bot pausado', detail: 'Respuestas desactivadas' },
    unlinked: { title: 'Sin vincular', detail: 'Conectá tu WhatsApp' },
    'cost-blocked': { title: 'Bot bloqueado', detail: 'Mensajes pagos no autorizados' },
    loading: { title: 'Comprobando bot', detail: 'Consultando configuración' },
    unknown: { title: 'Estado no disponible', detail: 'Revisá la configuración' },
  }[botState];

  useEffect(() => {
    let active = true;
    supabase
      .from('categories')
      .select('id,name,kind')
      .eq('user_id', userId)
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        if (!active) return;
        setCategories((data ?? []).map((category) => ({
          id: String(category.id),
          name: String(category.name),
          kind: category.kind as 'expense' | 'income',
        })));
      });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!availableCategories.some((category) => category.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? '');
    }
  }, [availableCategories, categoryId]);

  useEffect(() => {
    let active = true;
    let loading = false;
    const monthStart = `${month}-01`;
    const monthEnd = `${shiftMonth(month, 1)}-01`;
    const loadDashboard = async () => {
      if (loading) return;
      loading = true;
      const [transactions, budgets, allInstallments, whatsappLink, appSettings, distinctMonthsRes, botPhoneRes] = await Promise.all([
        supabase.from('transactions').select('id,description,amount_ars,currency,occurred_on,kind,category_id,categories(name),installment_number,installment_count,installment_group_id').eq('user_id', userId).eq('status', 'confirmed').gte('occurred_on', monthStart).lt('occurred_on', monthEnd).order('occurred_on', { ascending: false }),
        supabase.from('budgets').select('amount_ars').eq('user_id', userId).eq('month', monthStart).maybeSingle(),
        supabase.from('transactions').select('id,description,amount_ars,currency,occurred_on,kind,category_id,categories(name),installment_number,installment_count,installment_group_id').eq('user_id', userId).eq('status', 'confirmed').gt('installment_count', 1).order('occurred_on', { ascending: true }),
        supabase.from('whatsapp_links').select('status').eq('user_id', userId).maybeSingle(),
        supabase.from('app_settings').select('whatsapp_responses_enabled').eq('user_id', userId).maybeSingle(),
        supabase.rpc('get_distinct_transaction_months'),
        supabase.from('system_config').select('value').eq('key', 'whatsapp_bot_phone').maybeSingle(),
      ]);
      loading = false;
      if (!active) return;
      if (botPhoneRes?.data?.value) setWaBotNumber(botPhoneRes.data.value);
      if (!transactions.error) {
        setMovements((transactions.data ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          title: String(row.description),
          category: String((row.categories as { name?: string } | null)?.name ?? 'Otros'),
          categoryId: row.category_id ? String(row.category_id) : undefined,
          amount: Number(row.amount_ars),
          currency: (row.currency === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
          date: String(row.occurred_on),
          kind: row.kind as 'expense' | 'income',
          installmentNumber: row.installment_number ? Number(row.installment_number) : null,
          installmentCount: row.installment_count ? Number(row.installment_count) : null,
          installmentGroupId: row.installment_group_id ? String(row.installment_group_id) : null,
        })));
      }

      if (!budgets.error) setBudget(budgets.data?.amount_ars ? Number(budgets.data.amount_ars) : 0);
      if (whatsappLink.error || appSettings.error || !appSettings.data) {
        setBotState('unknown');
      } else if (whatsappLink.data?.status !== 'active') {
        setBotState('unlinked');
      } else if (!appSettings.data.whatsapp_responses_enabled) {
        setBotState('paused');
      } else {
        setBotState('active');
      }
      const monthsFound = new Set<string>();
      if (!distinctMonthsRes.error && Array.isArray(distinctMonthsRes.data)) {
        distinctMonthsRes.data.forEach((item: unknown) => {
          if (typeof item === 'string' && /^\d{4}-\d{2}$/.test(item)) {
            monthsFound.add(item);
          } else if (item && typeof item === 'object' && 'month' in item) {
            const m = String((item as { month?: unknown }).month);
            if (/^\d{4}-\d{2}$/.test(m)) monthsFound.add(m);
          }
        });
      } else {
        // Fallback resiliente: Si la función RPC aún no fue migrada en la base de datos remota
        const fallback = await supabase
          .from('transactions')
          .select('occurred_on')
          .eq('user_id', userId)
          .eq('status', 'confirmed');
        (fallback.data ?? []).forEach((row: Record<string, unknown>) => {
          if (row.occurred_on) monthsFound.add(String(row.occurred_on).slice(0, 7));
        });
      }
      (allInstallments.data ?? []).forEach((row: Record<string, unknown>) => {
        if (row.occurred_on) monthsFound.add(String(row.occurred_on).slice(0, 7));
      });
      setKnownMonths(Array.from(monthsFound));

      if (!allInstallments.error && allInstallments.data) {
        const groups = new Map<string, Array<Record<string, unknown>>>();
        allInstallments.data.forEach((row: Record<string, unknown>) => {
          const key = String(row.installment_group_id || row.description);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row);
        });

        // Respetar las fechas guardadas, incluso si se eliminó una cuota.
        // Reprogramar un plan es una acción explícita del formulario de edición.

        const currentKey = month; // Evaluamos las cuotas relativas al mes que el usuario está viendo en pantalla
        const computedPlans: InstallmentPlan[] = [];
        groups.forEach((rows, groupId) => {
          const totalCount = Number(rows[0]?.installment_count ?? rows.length);
          const desc = String(rows[0]?.description ?? 'Compra en cuotas');
          const monthlyAmount = Number(rows[0]?.amount_ars ?? 0);
          const paidRows = rows.filter((r) => String(r.occurred_on).slice(0, 7) < currentKey);
          const remainingRows = rows.filter((r) => String(r.occurred_on).slice(0, 7) >= currentKey);
          const currentRow = rows.find((r) => String(r.occurred_on).slice(0, 7) === currentKey);

          const paidCount = paidRows.length;
          const currentNumber = currentRow?.installment_number ? Number(currentRow.installment_number) : Math.min(paidCount + 1, totalCount);
          const vanCount = currentNumber;
          const quedanCount = Math.max(totalCount - vanCount, 0);
          const quedanTotal = quedanCount * monthlyAmount;
          const progressPercent = Math.round((vanCount / totalCount) * 100);
          const currentDateStr = currentRow ? String(currentRow.occurred_on) : String(remainingRows[0]?.occurred_on ?? '');

          const nextRow = nextScheduledInstallment(rows, month, todayKey());
          const rowToEdit = currentRow ?? rows[0];
          const currentMovement: Movement | undefined = rowToEdit ? {
            id: String(rowToEdit.id),
            title: String(rowToEdit.description),
            amount: Number(rowToEdit.amount_ars),
            currency: (rowToEdit.currency === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
            category: String((rowToEdit.categories as { name?: string } | null)?.name ?? 'Compras'),
            categoryId: rowToEdit.category_id ? String(rowToEdit.category_id) : undefined,
            date: String(rowToEdit.occurred_on),
            kind: (rowToEdit.kind || 'expense') as 'expense' | 'income',
            installmentNumber: rowToEdit.installment_number ? Number(rowToEdit.installment_number) : 1,
            installmentCount: totalCount,
            installmentGroupId: groupId,
          } : undefined;

          // Cuando ya se acabaron las cuotas (es decir, no quedan cuotas pendientes en o después de este mes),
          // el cuadro de esa compra desaparece por completo del resumen de cuotas
          if (remainingRows.length > 0) {
            computedPlans.push({
              groupId,
              description: desc,
              totalAmount: rows.reduce((sum, r) => sum + Number(r.amount_ars), 0),
              currency: (rows[0]?.currency === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
              installmentCount: totalCount,
              vanCount,
              monthlyAmount,
              quedanCount,
              quedanTotal,
              progressPercent,
              currentDateStr,
              nextScheduled: nextRow ? {
                ...currentMovement!,
                id: String(nextRow.id),
                title: String(nextRow.description),
                category: String((nextRow.categories as { name?: string } | null)?.name ?? 'Compras'),
                categoryId: nextRow.category_id ? String(nextRow.category_id) : undefined,
                kind: (nextRow.kind || 'expense') as 'expense' | 'income',
                date: String(nextRow.occurred_on),
                amount: Number(nextRow.amount_ars),
                currency: nextRow.currency === 'USD' ? 'USD' : 'ARS',
                installmentNumber: Number(nextRow.installment_number || 1),
              } : undefined,
              currentMovement,
            });
          }
        });

        setInstallmentPlans(computedPlans);
      }
    };
    void loadDashboard();
    const channel = supabase.channel(`dashboard-${userId}-${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `user_id=eq.${userId}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_links', filter: `user_id=eq.${userId}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `user_id=eq.${userId}` }, loadDashboard)
      .subscribe();
    const interval = window.setInterval(loadDashboard, 5000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void loadDashboard(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [month, userId]);

  function openBudgetModal() {
    setBudgetInput(budget > 0 ? numberToAmountInput(budget) : '');
    setShowBudgetModal(true);
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = parseAmountNumber(budgetInput);
    if (!Number.isFinite(next) || next <= 0) {
      window.alert('Ingresá un monto de presupuesto válido mayor a 0.');
      return;
    }
    setIsSavingBudget(true);
    const { error } = await supabase
      .from('budgets')
      .upsert(
        { user_id: userId, month: `${month}-01`, amount_ars: next },
        { onConflict: 'user_id,month' }
      );
    setIsSavingBudget(false);
    if (error) {
      return window.alert('No pudimos guardar el presupuesto. Intentá nuevamente.');
    }
    setBudget(next);
    setShowBudgetModal(false);
  }

  async function executeDeleteBudget() {
    if (budget <= 0) return;
    setIsSavingBudget(true);
    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('user_id', userId)
      .eq('month', `${month}-01`);

    setIsSavingBudget(false);
    if (error) {
      return window.alert('No pudimos eliminar el presupuesto. Intentá nuevamente.');
    }
    setBudget(0);
    setBudgetInput('');
    setShowDeleteBudgetConfirm(false);
    setShowBudgetModal(false);
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currency = (form.get('currency') as 'ARS' | 'USD') || manualCurrency;
    const kind = form.get('kind') as 'expense' | 'income';
    const selectedCategory = categories.find((category) => category.id === categoryId && category.kind === kind);
    if (!selectedCategory) return window.alert('Seleccioná una categoría válida.');
    const description = String(form.get('description')).trim();
    const enteredAmount = parseAmountNumber(formAmount);
    const dateStr = String(form.get('date'));
    if (!description || !enteredAmount || enteredAmount <= 0) return;

    if (kind === 'expense' && isInstallments && installmentCount > 1) {
      const selectedCurrentCuota = currentInstallmentNumber;
      const targetMonth = dateStr.slice(0, 7);
      const day = dateStr.slice(8, 10);
      const startMonth = shiftMonth(targetMonth, -(selectedCurrentCuota - 1));

      const totalAmount = installmentAmountMode === 'quota'
        ? Math.round(enteredAmount * installmentCount * 100) / 100
        : enteredAmount;

      const { data: parent, error: parentError } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          kind: 'expense',
          description,
          amount_ars: totalAmount,
          currency,
          occurred_on: installmentDate(startMonth, Number(day)),
          category_id: selectedCategory.id,
          status: 'cancelled',
          source: 'pwa',
          installment_count: installmentCount,
          first_installment_month: startMonth,
        })
        .select('id')
        .single();

      if (parentError || !parent) {
        return window.alert('No pudimos registrar la compra en cuotas. Intentá nuevamente.');
      }

      const values = installmentAmountMode === 'quota'
        ? Array.from({ length: installmentCount }, () => enteredAmount)
        : splitInstallments(totalAmount, installmentCount);

      const rows = values.map((amount, index) => ({
        user_id: userId,
        kind: 'expense',
        description,
        amount_ars: amount,
        currency,
        occurred_on: installmentDate(shiftMonth(startMonth, index), Number(day)),
        category_id: selectedCategory.id,
        status: 'confirmed',
        source: 'pwa',
        installment_group_id: parent.id,
        installment_number: index + 1,
        installment_count: installmentCount,
      }));

      const { error: batchError } = await supabase.from('transactions').insert(rows);
      if (batchError) {
        return window.alert('Hubo un error guardando las cuotas. Intentá nuevamente.');
      }

      const addedMonths = Array.from({ length: installmentCount }, (_, i) => shiftMonth(startMonth, i));
      setKnownMonths((prev) => Array.from(new Set([...prev, ...addedMonths])));
      setMonth(targetMonth);
      setActiveCurrency(currency);

      setShowAdd(false);
      setIsInstallments(false);
      setInstallmentCount(3);
      setIsCustomInstallmentCount(false);
      setCustomCountInput('3');
      setInstallmentAmountMode('total');
      setCurrentInstallmentNumber(1);
      setFormAmount('');
      return;
    } else {
      const { error } = await supabase.from('transactions').insert({
        user_id: userId,
        kind,
        description,
        amount_ars: enteredAmount,
        currency,
        occurred_on: dateStr,
        category_id: selectedCategory.id,
        status: 'confirmed',
        source: 'pwa',
      });
      if (error) return window.alert('No pudimos guardar el movimiento.');
    }

    const targetMonth = dateStr.slice(0, 7);
    setKnownMonths((prev) => Array.from(new Set([...prev, targetMonth])));
    setMonth(targetMonth);
    setActiveCurrency(currency);

    setShowAdd(false);
    setIsInstallments(false);
    setInstallmentCount(3);
    setIsCustomInstallmentCount(false);
    setCustomCountInput('3');
    setInstallmentAmountMode('total');
    setCurrentInstallmentNumber(1);
    setFormAmount('');
  }

  function startEditMovement(item: Movement) {
    setEditingMovement(item);
    setEditDescription(item.title);
    setEditAmount(numberToAmountInput(item.amount));
    setEditKind(item.kind);
    setEditCurrency(item.currency || 'ARS');
    const matchingCatId = item.categoryId ?? categories.find((c) => c.name === item.category && c.kind === item.kind)?.id ?? '';
    setEditCategoryId(matchingCatId);
    setEditDate(item.date);
    const count = item.installmentCount ?? 3;
    setEditInstallmentCount(count);
    const isCustom = !PRESET_INSTALLMENT_COUNTS.includes(count);
    setIsCustomEditInstallmentCount(isCustom);
    setCustomEditCountInput(String(count));
    const num = Math.min(item.installmentNumber ?? 1, count);
    setEditInstallmentNumber(num);
    setEditApplyToAll(Boolean(item.installmentCount && item.installmentCount > 1));
  }

  async function saveMovementEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMovement) return;
    const description = editDescription.trim();
    const amount = parseAmountNumber(editAmount);
    const dateStr = editDate;
    if (!description || !amount || amount <= 0 || !dateStr) return;

    const selectedCategory = categories.find((c) => c.id === editCategoryId && c.kind === editKind);
    if (!selectedCategory) return window.alert('Seleccioná una categoría válida.');

    setIsSavingEdit(true);

    const isInstallmentPlan = Boolean(editingMovement.installmentCount && editingMovement.installmentCount > 1 && editingMovement.installmentGroupId);
    const targetMonth = dateStr.slice(0, 7);
    const targetDay = dateStr.slice(8, 10);

    if (isInstallmentPlan && editApplyToAll) {
      const groupId = editingMovement.installmentGroupId!;
      const currentCuotaNum = editInstallmentNumber;
      const totalCuotas = editInstallmentCount;
      const newStartMonth = shiftMonth(targetMonth, -(currentCuotaNum - 1));

      // 1. Buscamos todas las cuotas de este plan
      const { data: groupRows, error: fetchErr } = await supabase
        .from('transactions')
        .select('id, installment_number, installment_count, occurred_on')
        .eq('user_id', userId)
        .eq('installment_group_id', groupId)
        .eq('status', 'confirmed');

      if (fetchErr) {
        setIsSavingEdit(false);
        return window.alert('No pudimos consultar las cuotas del plan.');
      }

      const rows = (groupRows ?? []).slice();
      rows.sort((a, b) => Number(a.installment_number ?? 1) - Number(b.installment_number ?? 1));

      const updatePromises: Array<PromiseLike<{ error: unknown }>> = [];
      const rowsToInsert: Array<Record<string, unknown>> = [];
      const rowsToDelete: string[] = [];

      for (let i = 1; i <= totalCuotas; i++) {
        const cuotaMonth = shiftMonth(newStartMonth, i - 1);
        const cuotaDate = installmentDate(cuotaMonth, Number(targetDay));
        const existing = rows[i - 1];

        if (existing) {
          updatePromises.push(
            supabase
              .from('transactions')
              .update({
                description,
                category_id: selectedCategory.id,
                occurred_on: cuotaDate,
                amount_ars: amount,
                currency: editCurrency,
                installment_number: i,
                installment_count: totalCuotas,
              })
              .eq('id', existing.id)
              .eq('user_id', userId)
          );
        } else {
          rowsToInsert.push({
            user_id: userId,
            kind: 'expense',
            description,
            amount_ars: amount,
            currency: editCurrency,
            occurred_on: cuotaDate,
            category_id: selectedCategory.id,
            status: 'confirmed',
            source: 'pwa',
            installment_group_id: groupId,
            installment_number: i,
            installment_count: totalCuotas,
          });
        }
      }

      if (rows.length > totalCuotas) {
        for (let i = totalCuotas; i < rows.length; i++) {
          rowsToDelete.push(String(rows[i].id));
        }
      }

      if (rowsToInsert.length > 0) {
        updatePromises.push(supabase.from('transactions').insert(rowsToInsert));
      }
      if (rowsToDelete.length > 0) {
        updatePromises.push(supabase.from('transactions').delete().in('id', rowsToDelete).eq('user_id', userId));
      }

      // 3. Actualizamos también el registro padre
      const parentPromise = supabase
        .from('transactions')
        .update({
          description,
          category_id: selectedCategory.id,
          first_installment_month: newStartMonth,
          occurred_on: installmentDate(newStartMonth, Number(targetDay)),
          amount_ars: amount * totalCuotas,
          currency: editCurrency,
          installment_count: totalCuotas,
        })
        .eq('id', groupId)
        .eq('user_id', userId);

      const results = await Promise.all([...updatePromises, parentPromise]);
      const hasError = results.some((r) => r.error);
      if (hasError) {
        setIsSavingEdit(false);
        return window.alert('No pudimos actualizar todas las cuotas del plan.');
      }

      const addedMonths = Array.from({ length: totalCuotas }, (_, i) => shiftMonth(newStartMonth, i));
      setKnownMonths((prev) => Array.from(new Set([...prev, ...addedMonths])));
    } else {
      const { error } = await supabase
        .from('transactions')
        .update({
          description,
          amount_ars: amount,
          currency: editCurrency,
          kind: editKind,
          category_id: selectedCategory.id,
          occurred_on: dateStr,
          installment_number: isInstallmentPlan ? editInstallmentNumber : editingMovement.installmentNumber,
          installment_count: isInstallmentPlan ? editInstallmentCount : editingMovement.installmentCount,
        })
        .eq('id', editingMovement.id)
        .eq('user_id', userId);

      if (error) {
        setIsSavingEdit(false);
        return window.alert('No pudimos actualizar el movimiento. Intentá nuevamente.');
      }
    }

    setMovements((current) =>
      current.map((m) => {
        if (m.id === editingMovement.id) {
          return {
            ...m,
            title: description,
            amount,
            currency: editCurrency,
            kind: editKind,
            category: selectedCategory.name,
            categoryId: selectedCategory.id,
            date: dateStr,
            installmentNumber: isInstallmentPlan ? editInstallmentNumber : m.installmentNumber,
            installmentCount: isInstallmentPlan ? editInstallmentCount : m.installmentCount,
          };
        }
        if (isInstallmentPlan && editApplyToAll && m.installmentGroupId === editingMovement.installmentGroupId) {
          return {
            ...m,
            title: description,
            currency: editCurrency,
            category: selectedCategory.name,
            categoryId: selectedCategory.id,
            installmentCount: editInstallmentCount,
          };
        }
        return m;
      })
    );

    setIsSavingEdit(false);
    setEditingMovement(null);

    // Navegación automática: si el movimiento fue asignado a otro mes (ej. Julio), cargamos ese mes para verlo
    setKnownMonths((prev) => Array.from(new Set([...prev, targetMonth])));
    if (targetMonth !== month) {
      setMonth(targetMonth);
    }
  }

  async function executeDeleteSingleMovement(item: Movement) {
    const previous = movements;
    setMovements((current) => current.filter((movement) => movement.id !== item.id));
    const { error } = await supabase.from('transactions').delete().eq('id', item.id).eq('user_id', userId);
    if (error) {
      setMovements(previous);
      window.alert('No pudimos eliminar el movimiento. Intentá nuevamente.');
    }
  }

  function deleteMovement(item: Movement) {
    if (item.installmentCount && item.installmentCount > 1) {
      setInstallmentDeletePrompt({ movement: item });
      return;
    }
    if (!window.confirm(`¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`)) return;
    void executeDeleteSingleMovement(item);
  }

  async function executeDeleteSingleInstallment(item: Movement) {
    setInstallmentDeletePrompt(null);
    await executeDeleteSingleMovement(item);
  }

  async function executeDeleteFullPlan(target: Movement | InstallmentPlan) {
    setInstallmentDeletePrompt(null);
    const groupId = 'groupId' in target ? target.groupId : (target.installmentGroupId || target.id);
    const targetDesc = 'title' in target ? target.title : target.description;

    const previousMovements = movements;
    const previousPlans = installmentPlans;

    setMovements((current) => current.filter((m) => m.installmentGroupId !== groupId && m.id !== groupId && m.title !== targetDesc));
    setInstallmentPlans((current) => current.filter((p) => p.groupId !== groupId && p.description !== targetDesc));

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('user_id', userId)
      .or(`installment_group_id.eq.${groupId},id.eq.${groupId}`);

    if (error) {
      setMovements(previousMovements);
      setInstallmentPlans(previousPlans);
      window.alert('No pudimos eliminar el plan de cuotas. Intentá nuevamente.');
    }
  }


  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><span>Pesito</span></div>
      <nav aria-label="Navegación principal">
        <a className={`nav-item ${activeSection === '#resumen' ? 'active' : ''}`} aria-current={activeSection === '#resumen' ? 'page' : undefined} href="#resumen"><span><IconHome /></span>Resumen</a>
        <a className={`nav-item ${activeSection === '#movimientos' ? 'active' : ''}`} aria-current={activeSection === '#movimientos' ? 'page' : undefined} href="#movimientos"><span><IconMovements /></span>Movimientos</a>
        <a className={`nav-item ${activeSection === '#cuotas' ? 'active' : ''}`} aria-current={activeSection === '#cuotas' ? 'page' : undefined} href="#cuotas"><span><IconInstallments /></span>Cuotas</a>
        <button className="nav-item nav-button" type="button" onClick={onOpenSettings}><span><IconSettings /></span>Configuración</button>
      </nav>
      <nav className="sidebar-tools" aria-label="Herramientas">
        {isAdmin && onOpenAdmin && (
          <button className="nav-item nav-button" type="button" onClick={onOpenAdmin}>
            <span><Icon name="shield" /></span>Panel Admin
          </button>
        )}
        {canInstall && (
          <button
            className="nav-item nav-button"
            type="button"
            onClick={triggerInstall}
            style={{ color: 'var(--mint-dark)', fontWeight: 700 }}
          >
            <span><Icon name="smartphone" /></span>Instalar app
          </button>
        )}
      </nav>
      <div className={`bot-status bot-status-${botState}`}><span className="status-dot"/><div><strong>{botStatus.title}</strong><small>{botStatus.detail}</small></div></div>
      <button className="profile logout-button" type="button" onClick={onSignOut}><span>{userInitials}</span><div><strong>{userDisplayName}</strong><small>Cerrar sesión</small></div><b>›</b></button>
    </aside>
    <section className="content" id="resumen">
      <header className="topbar">
        <div>
          {activeSection === '#movimientos' ? (
            <>
              <p className="eyebrow">TUS OPERACIONES</p>
              <h1>Movimientos</h1>
              <p>Buscá, filtrá y revisá tus operaciones día por día en {labelForMonth(month).toLowerCase()}.</p>
            </>
          ) : activeSection === '#cuotas' ? (
            <>
              <p className="eyebrow">COMPRAS FINANCIADAS</p>
              <h1>Cuotas</h1>
              <p>Seguimiento de tus compras activas y próximos vencimientos.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">TU RESUMEN</p>
              <h1>Hola, {firstName} <span>👋</span></h1>
              <p>Así vienen tus finanzas este mes.</p>
            </>
          )}
        </div>
        <div className="top-actions">
          <select aria-label="Mes" value={month} onChange={(event) => setMonth(event.target.value)}>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {labelForMonth(m)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* WHATSAPP ONBOARDING BANNER (FASE 4) */}
      {botState === 'unlinked' && (
        <section className="whatsapp-onboarding-banner">
          <div className="onboarding-badge-icon"><Icon name="message" size={28} /></div>
          <div className="onboarding-details">
            <span className="onboarding-step-tag">VINCULACIÓN RÁPIDA</span>
            <h2>Conectá tu WhatsApp en 1 toque</h2>
            <p>
              Registrá tus gastos e ingresos enviando mensajes de texto, audios o fotos de comprobantes directamente por WhatsApp.
            </p>
            <div className="onboarding-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="whatsapp-onboarding-btn"
                onClick={() => void handleConnectWhatsApp()}
                disabled={isConnectingWa}
              >
                {isConnectingWa ? 'Generando código…' : <><Icon name="message" /> Conectar mi WhatsApp en 1 toque</>}
              </button>
              {waLinkReady && (
                <a
                  href={waLinkReady.url}
                  className="whatsapp-onboarding-btn"
                  style={{ background: '#128c7e', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Icon name="message" /> Abrir WhatsApp ahora (Código: {waLinkReady.code})
                </a>
              )}
            </div>
            {onboardingWaMsg && (
              <p className="onboarding-note">{onboardingWaMsg}</p>
            )}
          </div>
        </section>
      )}

      <div className="currency-switch-bar">
        <div className="currency-pills" role="tablist" aria-label="Seleccionar moneda">
          <button
            type="button"
            role="tab"
            aria-label="Pesos argentinos (ARS)"
            aria-selected={activeCurrency === 'ARS'}
            className={`currency-pill ${activeCurrency === 'ARS' ? 'active' : ''}`}
            onClick={() => setActiveCurrency('ARS')}
          >
            <span className="currency-code" aria-hidden="true">ARS</span>
            <span>Pesos</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-label="Dólares estadounidenses (USD)"
            aria-selected={activeCurrency === 'USD'}
            className={`currency-pill ${activeCurrency === 'USD' ? 'active' : ''}`}
            onClick={() => setActiveCurrency('USD')}
          >
            <span className="currency-code" aria-hidden="true">USD</span>
            <span>Dólares</span>
          </button>
        </div>
      </div>
      {activeSection === '#movimientos' ? (
        <section className="movements-view" id="movimientos" aria-label={`Movimientos en ${activeCurrency}`}>
          <div className="movements-sticky-bar">
            <div className="movements-search-box">
              <Icon name="search" size={18} className="movements-search-icon" />
              <input
                type="search"
                className={`movements-search-input ${movementSearch ? 'has-value' : ''}`}
                placeholder="Buscar movimiento o categoría…"
                aria-label="Buscar movimientos"
                value={movementSearch}
                onChange={(event) => setMovementSearch(event.target.value)}
              />
              {movementSearch && (
                <button
                  type="button"
                  className="movements-search-clear"
                  aria-label="Limpiar búsqueda"
                  onClick={() => setMovementSearch('')}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
            <div className="movements-filter-controls">
              <div className="movements-kind-pills" role="group" aria-label="Filtrar por tipo de movimiento">
                <button
                  type="button"
                  className={`movements-kind-pill ${movementKindFilter === 'all' ? 'active' : ''}`}
                  aria-pressed={movementKindFilter === 'all'}
                  onClick={() => setMovementKindFilter('all')}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className={`movements-kind-pill ${movementKindFilter === 'expense' ? 'active' : ''}`}
                  aria-pressed={movementKindFilter === 'expense'}
                  onClick={() => setMovementKindFilter('expense')}
                >
                  Gastos
                </button>
                <button
                  type="button"
                  className={`movements-kind-pill ${movementKindFilter === 'income' ? 'active' : ''}`}
                  aria-pressed={movementKindFilter === 'income'}
                  onClick={() => setMovementKindFilter('income')}
                >
                  Ingresos
                </button>
              </div>
              <select
                aria-label="Filtrar por categoría"
                className="movements-category-select"
                value={movementCategoryFilter}
                onChange={(event) => setMovementCategoryFilter(event.target.value)}
              >
                <option value="all">Todas las categorías</option>
                {movementCategoryOptions.map((catName) => (
                  <option key={catName} value={catName}>
                    {catName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <article className="panel movements-full-card">
            {filteredMovements.length === 0 ? (
              <div className="budget-empty movements-empty-state">
                <span className="summary-empty-icon"><Icon name="movements" size={24} /></span>
                <strong>Todavía no hay movimientos en {activeCurrency} este mes</strong>
                <p>Registrá un gasto o ingreso por WhatsApp o desde el botón de agregar para verlo agrupado por día.</p>
              </div>
            ) : groupedMovementsByDay.length === 0 ? (
              <div className="budget-empty movements-empty-state">
                <span className="summary-empty-icon"><Icon name="search" size={24} /></span>
                <strong>No encontramos movimientos con ese filtro</strong>
                <p>Probá con otra palabra clave, tipo de operación o categoría.</p>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setMovementSearch('');
                    setMovementKindFilter('all');
                    setMovementCategoryFilter('all');
                  }}
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <>
                <div className="movements-results-meta">
                  <span>
                    Mostrando <strong>{searchedMovements.length}</strong>{' '}
                    {searchedMovements.length === 1 ? 'operación' : 'operaciones'} de {labelForMonth(month).toLowerCase()}
                  </span>
                  {hasActiveMovementFilters && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setMovementSearch('');
                        setMovementKindFilter('all');
                        setMovementCategoryFilter('all');
                      }}
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>
                <div className="movements-day-groups">
                  {groupedMovementsByDay.map((group) => (
                    <div className="movement-day-group" key={group.date}>
                      <div className="movement-day-header">
                        <strong className="movement-day-title">{group.label}</strong>
                        <span className={`movement-day-subtotal ${group.netAmount < 0 ? 'expense' : group.netAmount > 0 ? 'income' : ''}`}>
                          Subtotal: {group.netAmount < 0 ? '−' : group.netAmount > 0 ? '+' : ''}
                          {formatMoney(Math.abs(group.netAmount), activeCurrency)}
                        </span>
                      </div>
                      <div className="movement-list">
                        {group.items.map((item) => (
                          <div
                            className="movement"
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEditMovement(item)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEditMovement(item); }}
                            aria-label={`Ver o editar ${item.title}`}
                          >
                            <span
                              className={`movement-icon ${item.kind}`}
                              style={{
                                color: movementVisual(item.category, item.kind).color,
                                backgroundColor: movementVisual(item.category, item.kind).background,
                              }}
                            >
                              <Icon name={movementVisual(item.category, item.kind).icon} />
                            </span>
                            <div className="movement-info">
                              <strong>{item.title}</strong>
                              <small>
                                {item.category}
                                {item.installmentCount && item.installmentCount > 1
                                  ? ` · Cuota ${item.installmentNumber ?? 1}/${item.installmentCount}`
                                  : ''}
                              </small>
                            </div>
                            <div className="movement-right">
                              <b className={item.kind}>
                                {item.kind === 'expense' ? '−' : '+'}
                                {formatMoney(item.amount, item.currency)}
                              </b>
                            </div>
                            <Icon name="chevronRight" className="movement-chevron ui-icon" size={18} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>
        </section>
      ) : activeSection === '#cuotas' ? (
        <section className="installments-view" id="cuotas" aria-label={`Compras en cuotas en ${activeCurrency}`}>
          <div className="summary-grid installments-summary-grid">
            <article className="summary-card balance installments-kpi-primary">
              <div className="card-heading">
                <span className="metric-icon"><Icon name="card" /></span>
                <small>TOTAL ESTE MES EN CUOTAS ({activeCurrency})</small>
              </div>
              <strong>{formatMoney(installmentsSummary.monthlyTotal, activeCurrency)}</strong>
              <p>
                {installmentsSummary.monthInstallmentsCount === 0
                  ? `Sin cuotas registradas en ${labelForMonth(month).toLowerCase()}`
                  : `${installmentsSummary.monthInstallmentsCount} ${installmentsSummary.monthInstallmentsCount === 1 ? 'cuota registrada' : 'cuotas registradas'} en ${labelForMonth(month).toLowerCase()}`}
              </p>
            </article>
            <article className="summary-card installments-kpi-secondary">
              <div className="card-heading">
                <span className="metric-icon"><Icon name="receipt" /></span>
                <small>COMPRAS ACTIVAS</small>
              </div>
              <strong>
                {installmentsSummary.activePlansCount}{' '}
                {installmentsSummary.activePlansCount === 1 ? 'compra' : 'compras'}
              </strong>
              <p>
                {upcomingPlans.length > 0
                  ? `${upcomingPlans.length} con próximo vencimiento programado`
                  : 'Planes vigentes en el período consultado'}
              </p>
            </article>
          </div>

          <article className="panel installments-full-card">
            <div className="panel-title">
              <div>
                <h2>Compras en cuotas ({activeCurrency})</h2>
                <p>Progreso de cada compra, próximo vencimiento y monto de cuota</p>
              </div>
              <span className="pill">
                {filteredInstallmentPlans.length}{' '}
                {filteredInstallmentPlans.length === 1 ? 'activa' : 'activas'}
              </span>
            </div>

            {filteredInstallmentPlans.length === 0 ? (
              <div className="budget-empty installments-empty-state">
                <span className="summary-empty-icon"><Icon name="card" size={24} /></span>
                <strong>No tenés compras en cuotas activas en {activeCurrency}</strong>
                <p>Cuando registres una compra en cuotas, vas a poder seguir su progreso y próximos vencimientos acá.</p>
              </div>
            ) : (
              <div className="installments-list installments-dedicated-list">
                {filteredInstallmentPlans.map((plan) => {
                  const targetMov = plan.nextScheduled ?? plan.currentMovement;
                  const shownQuotaNum = targetMov?.installmentNumber ?? plan.vanCount;
                  const shownQuotaAmount = targetMov?.amount ?? plan.monthlyAmount;
                  const catName = targetMov?.category ?? 'Compras';
                  const vis = categoryVisual(catName);
                  const progressPct = Math.min(Math.round((shownQuotaNum / plan.installmentCount) * 100), 100);
                  const remainingAfterThis = Math.max(plan.installmentCount - shownQuotaNum, 0);
                  const isMenuOpen = openInstallmentMenuId === plan.groupId;

                  return (
                    <div className="installment-item installment-plan-card" key={plan.groupId}>
                      <div className="installment-plan-top">
                        <span
                          className="movement-icon expense"
                          style={{ color: vis.color, backgroundColor: `${vis.color}14` }}
                        >
                          <Icon name={vis.icon} />
                        </span>
                        <div className="installment-info-col">
                          <strong className="installment-title">{plan.description}</strong>
                          <small className="installment-subtitle">
                            {catName} ·{' '}
                            {plan.nextScheduled
                              ? `Próximo vencimiento: ${formatScheduledDate(plan.nextScheduled.date)}`
                              : `Fecha en período: ${formatMovementDate(plan.currentDateStr)}`}
                          </small>
                        </div>
                        <div className="installment-amount-col">
                          <strong className="installment-amount">{formatMoney(shownQuotaAmount, plan.currency)}</strong>
                          <span className="installment-cuota-badge">Cuota {shownQuotaNum}/{plan.installmentCount}</span>
                        </div>
                        <div className="installment-menu-wrap" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="installment-menu-trigger"
                            aria-label={`Opciones de ${plan.description}`}
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                            onClick={() => setOpenInstallmentMenuId(isMenuOpen ? null : plan.groupId)}
                          >
                            <Icon name="moreHorizontal" size={20} />
                          </button>
                          {isMenuOpen && (
                            <div className="installment-menu-popover" role="menu" aria-label={`Acciones de ${plan.description}`}>
                              <button
                                type="button"
                                role="menuitem"
                                className="installment-menu-item"
                                onClick={() => {
                                  setOpenInstallmentMenuId(null);
                                  if (targetMov) startEditMovement(targetMov);
                                }}
                              >
                                <Icon name="edit" size={16} /> Modificar
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="installment-menu-item danger"
                                onClick={() => {
                                  setOpenInstallmentMenuId(null);
                                  setInstallmentDeletePrompt({ plan });
                                }}
                              >
                                <Icon name="trash" size={16} /> Eliminar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className="installment-progress-bar"
                        role="progressbar"
                        aria-label={`Progreso de ${plan.description}: cuota ${shownQuotaNum} de ${plan.installmentCount}`}
                        aria-valuemin={0}
                        aria-valuemax={plan.installmentCount}
                        aria-valuenow={shownQuotaNum}
                      >
                        <div className="installment-progress-fill" style={{ width: `${progressPct}%` }} />
                      </div>
                      <div className="installment-plan-meta">
                        <span>
                          {remainingAfterThis === 0
                            ? 'Última cuota del plan'
                            : `Quedan ${remainingAfterThis} ${remainingAfterThis === 1 ? 'cuota' : 'cuotas'}`}
                        </span>
                        <span>
                          Total registrado: <strong>{formatMoney(plan.totalAmount, plan.currency)}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </section>
      ) : (
        <>
      <section className="summary-grid" aria-label={`Resumen mensual en ${activeCurrency}`}>
        <article className="summary-card balance">
          <div className="card-heading">
            <span className="metric-icon"><Icon name="wallet" /></span>
            <small>BALANCE {activeCurrency}</small>
          </div>
          <strong>{formatMoney(income - expenses, activeCurrency)}</strong>
          <p>Ingresos menos gastos</p>
        </article>
        <article className="summary-card expense">
          <div className="card-heading">
            <span className="metric-icon"><Icon name="arrowDownRight" /></span>
            <small>GASTOS {activeCurrency}</small>
          </div>
          <strong>{formatMoney(expenses, activeCurrency)}</strong>

        </article>
        <article className="summary-card income">
          <div className="card-heading">
            <span className="metric-icon"><Icon name="arrowUpRight" /></span>
            <small>INGRESOS {activeCurrency}</small>
          </div>
          <strong>{formatMoney(income, activeCurrency)}</strong>

        </article>
      </section>
      <section className={`main-grid summary-main-grid ${activeCurrency === 'USD' ? 'main-grid-usd' : ''}`}>
        {activeCurrency === 'ARS' && (
          <article className="panel budget-card">
            <div className="panel-title">
              <div>
                <h2>Presupuesto mensual</h2>
                <p>Tu límite de gastos para {labelForMonth(month).toLowerCase()}</p>
              </div>
              {budget > 0 && <button type="button" className="text-button" onClick={openBudgetModal}>Editar</button>}
            </div>
            {budget > 0 ? <>
              <div className="budget-numbers">
                <div><span>Gastado</span><strong>{formatMoney(expenses, 'ARS')}</strong></div>
                <div className="align-right"><span>Presupuesto</span><strong>{formatMoney(budget, 'ARS')}</strong></div>
              </div>
              <div className={`progress-track budget-${progress >= 100 ? 'over' : progress >= 80 ? 'near' : 'within'}`} role="progressbar" aria-label="Uso del presupuesto" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(progress, 100)} aria-valuetext={`${progress}% utilizado`}><span style={{ width: `${Math.min(progress, 100)}%` }}/></div>
              <div className="progress-copy">
                <span>{progress}% utilizado</span>
                <span>{expenses > budget ? 'Superaste el límite en ' : 'Te quedan '}<strong>{formatMoney(Math.abs(budget - expenses), 'ARS')}</strong></span>
              </div>
            </> : <div className="budget-empty">
              <span className="summary-empty-icon"><Icon name="wallet" size={24} /></span>
              <strong>Organizá tu mes con un presupuesto</strong>
              <p>Definí cuánto querés gastar y seguí tu progreso.</p>
              <button type="button" className="button-secondary" onClick={openBudgetModal}>Definir presupuesto</button>
            </div>}
          </article>
        )}
        <article className="panel category-card">
          <div className="panel-title">
            <div>
              <h2>Gastos por categoría {activeCurrency === 'USD' ? '(USD)' : ''}</h2>
              <p>Distribución del mes</p>
            </div>
            {chartData.length > 0 && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setExpandedCategoryInModal(null);
                  setShowCategoryModal(true);
                }}
              >
                {chartData.length > 4 ? 'Ver más' : 'Ver detalle'} <Icon name="chevronRight" size={16} />
              </button>
            )}
          </div>
          {chartData.length === 0 ? <div className="budget-empty">
            <span className="summary-empty-icon"><Icon name="receipt" size={24} /></span>
            <strong>Todavía no hay gastos en {activeCurrency}</strong>
            <p>Cuando registres uno, vas a ver su categoría acá.</p>
          </div> : <div className="chart-row">
            <div className="chart-summary">
              <div
                className="donut-chart interactive-donut"
                role="button"
                tabIndex={0}
                title="Hacé clic para ver el detalle de categorías"
                aria-label="Gráfico de gastos por categoría. Hacé clic para ver detalle ampliado."
                onClick={() => {
                  setExpandedCategoryInModal(null);
                  setShowCategoryModal(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setExpandedCategoryInModal(null);
                    setShowCategoryModal(true);
                  }
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      isAnimationActive={false}
                      innerRadius="60%"
                      outerRadius="85%"
                      paddingAngle={chartData.length > 1 ? 2 : 0}
                      stroke="none"
                    >
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={categoryVisual(entry.name).color}
                          opacity={dashboardActiveCategory && dashboardActiveCategory !== entry.name ? 0.45 : 1}
                          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                          onMouseEnter={() => { if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) setDashboardActiveCategory(entry.name); }}
                          onMouseLeave={() => setDashboardActiveCategory(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedCategoryInModal(entry.name);
                            setShowCategoryModal(true);
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center"><strong>{activeCurrency}</strong><span>{dashboardActiveCategory ? 'Categoría' : 'Total'}</span></div>
              </div>
              <strong className="chart-total">
                {formatMoney(dashboardActiveCategory ? chartData.find(c => c.name === dashboardActiveCategory)?.value ?? expenses : expenses, activeCurrency)}
              </strong>
              {dashboardActiveCategory && <span className="chart-selection">{dashboardActiveCategory}</span>}
            </div>
            <ul className="legend">
              {chartData.slice(0, 4).map((entry) => (
                <li
                  key={entry.name}
                  className="interactive-legend-item"
                  role="button"
                  tabIndex={0}
                  title={`Ver detalle de ${entry.name}`}
                  onMouseEnter={() => { if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) setDashboardActiveCategory(entry.name); }}
                  onMouseLeave={() => setDashboardActiveCategory(null)}
                  onClick={() => {
                    setExpandedCategoryInModal(entry.name);
                    setShowCategoryModal(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setExpandedCategoryInModal(entry.name);
                      setShowCategoryModal(true);
                    }
                  }}
                >
                  <i style={{ background: categoryVisual(entry.name).color }} />
                  <span>{entry.name}</span>
                  <strong>{expenses ? Math.round((entry.value / expenses) * 100) : 0}%</strong>
                </li>
              ))}
            </ul>
          </div>}
        </article>
        <article className="panel movements-card" id="movimientos">
          <div className="panel-title">
            <div>
              <h2>Últimos movimientos ({activeCurrency})</h2>
              <p>Tus últimas 5 operaciones del mes</p>
            </div>
            <a className="text-button summary-view-all" href="#movimientos">Ver todos<Icon name="chevronRight" size={16} /></a>
          </div>
          <div className="movement-list">
            {filteredMovements.length === 0 ? (
              <p className="empty-movements">Todavía no hay movimientos en {activeCurrency} este mes.</p>
            ) : (
              visibleMovements.map((item) => (
                <div
                  className="movement"
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => startEditMovement(item)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEditMovement(item); }}
                  aria-label={`Ver o editar ${item.title}`}
                >
                  <span className={`movement-icon ${item.kind}`} style={{ color: movementVisual(item.category, item.kind).color, backgroundColor: movementVisual(item.category, item.kind).background }}><Icon name={movementVisual(item.category, item.kind).icon} /></span>
                  <div className="movement-info">
                    <strong>{item.title}</strong>
                    <small>
                      {item.category} · {formatMovementDate(item.date)}
                      {item.installmentCount && item.installmentCount > 1 ? ` · Cuota ${item.installmentNumber ?? 1}/${item.installmentCount}` : ''}
                    </small>
                  </div>
                  <div className="movement-right">
                    <b className={item.kind}>{item.kind === 'expense' ? '−' : '+'}{formatMoney(item.amount, item.currency)}</b>
                  </div>
                  <Icon name="chevronRight" className="movement-chevron ui-icon" size={18} />
                </div>
              ))
            )}
          </div>
        </article>
        <article className="panel installments-card" id="cuotas">
          <div className="panel-title">
            <div>
              <h2>Próximas cuotas {activeCurrency === 'USD' ? '(USD)' : '(ARS)'}</h2>
              <p>Fechas programadas {month > currentMonth ? `desde ${formatMovementDate(`${month}-01`)}` : 'desde hoy'}</p>
            </div>
            <span className="pill">{upcomingPlans.length} {upcomingPlans.length === 1 ? 'compra' : 'compras'}</span>
          </div>
          {upcomingPlans.length === 0 ? (
            <div className="installments-empty">
              <span><Icon name="check" size={26} /></span>
              <strong>Sin próximas cuotas en {activeCurrency}</strong>
              <small>No hay próximas fechas de cuotas registradas para este período.</small>
            </div>
          ) : (
            <div className="installments-list">
              {upcomingPlans.map((plan) => (
                <div className="installment-item" key={plan.groupId}>
                  <div className="installment-header">
                    <div className="installment-info-col">
                      <span className="installment-date">Próxima · {formatScheduledDate(plan.nextScheduled!.date)}</span>
                      <strong className="installment-title">{plan.description}</strong>
                      <small className="installment-subtitle">Total registrado: {formatMoney(plan.totalAmount, plan.currency)}</small>
                    </div>
                    <div className="installment-amount-col">
                      <strong className="installment-amount">{formatMoney(plan.nextScheduled!.amount, plan.currency)}</strong>
                      <span className="installment-cuota-badge">Cuota {(plan.nextScheduled!.installmentNumber ?? 1)}/{plan.installmentCount}</span>
                    </div>
                  </div>
                  <div className="installment-progress-bar" aria-label={`${(plan.nextScheduled!.installmentNumber ?? 1) - 1} de ${plan.installmentCount} fechas de cuotas anteriores`}>
                    <div
                      className="installment-progress-fill"
                      style={{ width: `${Math.min((((plan.nextScheduled!.installmentNumber ?? 1) - 1) / plan.installmentCount) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="installment-footer-actions">
                    <button
                      type="button"
                      className="installment-edit-plan-btn"
                      onClick={() => {
                        if (plan.nextScheduled) {
                          startEditMovement(plan.nextScheduled);
                        }
                      }}
                      aria-label={`Modificar cuotas de ${plan.description}`}
                    >
                      <Icon name="edit" size={16} /> Modificar
                    </button>
                    <button
                      type="button"
                      className="installment-delete-plan-btn"
                      onClick={() => setInstallmentDeletePrompt({ plan })}
                      aria-label={`Eliminar plan ${plan.description}`}
                    >
                      <Icon name="trash" size={16} /> Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

      </section>
        </>
      )}
    </section>
    <nav className="mobile-nav" aria-label="Navegación móvil">
      <a className={activeSection === '#resumen' ? 'active' : ''} aria-current={activeSection === '#resumen' ? 'page' : undefined} href="#resumen">
        <IconHome />
        <span>Inicio</span>
      </a>
      <a className={activeSection === '#movimientos' ? 'active' : ''} aria-current={activeSection === '#movimientos' ? 'page' : undefined} href="#movimientos">
        <IconMovements />
        <span>Movimientos</span>
      </a>
      <button aria-label="Agregar movimiento" onClick={() => { setManualCurrency(activeCurrency); setShowAdd(true); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <a className={activeSection === '#cuotas' ? 'active' : ''} aria-current={activeSection === '#cuotas' ? 'page' : undefined} href="#cuotas">
        <IconInstallments />
        <span>Cuotas</span>
      </a>
      <button aria-label="Ajustes" onClick={onOpenSettings}>
        <IconSettings />
        <span>Ajustes</span>
      </button>
    </nav>
    <button className="desktop-add" onClick={() => { setManualCurrency(activeCurrency); setShowAdd(true); }}><Icon name="plus" /> Agregar movimiento</button>
    {showAdd && (

      <div className="modal-backdrop" role="presentation" onClick={() => setShowAdd(false)}>
        <form className="movement-form" onSubmit={addMovement} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div>
              <p className="eyebrow">NUEVO MOVIMIENTO</p>
              <h2>Registrá una operación</h2>
            </div>
            <button
              type="button"
              className="modal-close-x"
              aria-label="Cerrar modal"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowAdd(false);
                setIsInstallments(false);
                setInstallmentCount(3);
                setCurrentInstallmentNumber(1);
                setFormAmount('');
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <label>
            Descripción
            <input name="description" required placeholder="Ej. Verdulería o Compra en cuotas" />
          </label>
          <div className="form-grid">
            <label>
              Moneda
              <select
                name="currency"
                value={manualCurrency}
                onChange={(e) => setManualCurrency(e.target.value as 'ARS' | 'USD')}
              >
                <option value="ARS">Pesos (ARS)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </label>
            <label>
              Tipo
              <select
                name="kind"
                value={manualKind}
                onChange={(event) => {
                  const k = event.target.value as 'expense' | 'income';
                  setManualKind(k);
                  if (k === 'income') setIsInstallments(false);
                }}
              >
                <option value="expense">Gasto</option>
                <option value="income">Ingreso</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                {isInstallments && manualKind === 'expense'
                  ? (installmentAmountMode === 'quota' ? `Monto por cuota (${manualCurrency})` : `Monto total de la compra (${manualCurrency})`)
                  : `Monto (${manualCurrency})`}
              </span>
              {isInstallments && manualKind === 'expense' && (
                <div className="installment-mode-pills">
                  <button
                    type="button"
                    className={`mode-pill ${installmentAmountMode === 'total' ? 'active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setInstallmentAmountMode('total')}
                  >
                    Monto total
                  </button>
                  <button
                    type="button"
                    className={`mode-pill ${installmentAmountMode === 'quota' ? 'active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setInstallmentAmountMode('quota')}
                  >
                    Monto por cuota
                  </button>
                </div>
              )}
            </div>
            <input
              name="amount"
              required
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={formAmount}
              onChange={(e) => setFormAmount(formatAmountInput(e.target.value))}
            />
          </div>
          {manualKind === 'expense' && (
            <label className="switch-row" style={{ marginTop: '2px', padding: '6px 0' }}>
              <span>
                <strong style={{ fontSize: '13px' }}>¿Es una compra en cuotas?</strong>
                <small style={{ fontSize: '13px', color: 'var(--muted)' }}>Se crearán las cuotas para los próximos meses.</small>
              </span>
              <input
                type="checkbox"
                checked={isInstallments}
                onChange={(e) => setIsInstallments(e.target.checked)}
              />
            </label>
          )}
          {manualKind === 'expense' && isInstallments && (
            <>
              <div className="form-grid">
                <label>
                  Cantidad de cuotas
                  <select
                    name="installmentCountSelect"
                    value={isCustomInstallmentCount ? 'custom' : installmentCount}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setIsCustomInstallmentCount(true);
                        setCustomCountInput(String(installmentCount));
                      } else {
                        setIsCustomInstallmentCount(false);
                        const count = Number(e.target.value);
                        setInstallmentCount(count);
                        if (currentInstallmentNumber > count) setCurrentInstallmentNumber(1);
                      }
                    }}
                  >
                    {PRESET_INSTALLMENT_COUNTS.map((count) => (
                      <option key={count} value={count}>{count} cuotas</option>
                    ))}
                    <option value="custom">Personalizada (otra cantidad)…</option>
                  </select>
                </label>
                <label>
                  ¿Por qué cuota vas?
                  <select
                    name="currentInstallmentNumber"
                    value={currentInstallmentNumber}
                    onChange={(e) => setCurrentInstallmentNumber(Number(e.target.value))}
                  >
                    {Array.from({ length: installmentCount }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1° cuota (arranca este mes)' : `Cuota ${n} de ${installmentCount}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {isCustomInstallmentCount && (
                <label style={{ marginTop: '-4px' }}>
                  <span>Ingresá el número de cuotas (2 a 120):</span>
                  <input
                    type="number"
                    min="2"
                    max="120"
                    value={customCountInput}
                    onChange={(e) => {
                      const valStr = e.target.value;
                      setCustomCountInput(valStr);
                      const parsed = parseInt(valStr, 10);
                      if (!isNaN(parsed) && parsed >= 2) {
                        const clamped = Math.min(120, parsed);
                        setInstallmentCount(clamped);
                        if (currentInstallmentNumber > clamped) setCurrentInstallmentNumber(clamped);
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseInt(customCountInput, 10);
                      if (isNaN(parsed) || parsed < 2) {
                        setCustomCountInput('2');
                        setInstallmentCount(2);
                      } else if (parsed > 120) {
                        setCustomCountInput('120');
                        setInstallmentCount(120);
                      } else {
                        setCustomCountInput(String(parsed));
                        setInstallmentCount(parsed);
                      }
                    }}
                    placeholder="Ej. 7, 8, 14..."
                    autoFocus
                  />
                </label>
              )}
              <div className="installment-calc-preview">
                {installmentAmountMode === 'total' ? (
                  <>
                    <small>Valor por cuota ({installmentCount} cuotas):</small>
                    <strong>
                      {parseAmountNumber(formAmount) > 0
                        ? `${formatMoney(Math.round((parseAmountNumber(formAmount) / installmentCount) * 100) / 100, manualCurrency)} / mes`
                        : 'Ingresá el monto total'}
                    </strong>
                  </>
                ) : (
                  <>
                    <small>Total de la compra ({installmentCount} cuotas):</small>
                    <strong>
                      {parseAmountNumber(formAmount) > 0
                        ? `${formatMoney(Math.round(parseAmountNumber(formAmount) * installmentCount * 100) / 100, manualCurrency)} en total`
                        : 'Ingresá el monto por cuota'}
                    </strong>
                  </>
                )}
              </div>
              {currentInstallmentNumber > 1 && (
                <div className="installment-cuota-preview-hint">
                  Tarjeta en curso: En la fecha elegida se registrará la <strong>cuota {currentInstallmentNumber}</strong>. Las cuotas 1 a {currentInstallmentNumber - 1} se registrarán en los meses anteriores y las {installmentCount - currentInstallmentNumber} restantes en los próximos.
                </div>
              )}
            </>
          )}
          <div className="form-grid">
            <label>
              Categoría
              <select
                name="categoryId"
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="" disabled>Seleccioná una categoría</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              {isInstallments && manualKind === 'expense' ? (currentInstallmentNumber > 1 ? `Fecha cuota ${currentInstallmentNumber}` : 'Fecha 1° cuota') : 'Fecha'}
              <input name="date" required type="date" defaultValue={todayKey()} />
            </label>
          </div>
          <div className="modal-actions-grid-2">
            <button
              type="button"
              className="modal-btn-cancel"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowAdd(false);
                setIsInstallments(false);
                setInstallmentCount(3);
                setIsCustomInstallmentCount(false);
                setCustomCountInput('3');
                setInstallmentAmountMode('total');
                setCurrentInstallmentNumber(1);
                setFormAmount('');
              }}
            >
              Cancelar
            </button>
            <button
              className="modal-btn-save"
              type="submit"
              disabled={!categoryId}
              onMouseDown={(e) => e.preventDefault()}
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    )}

    {editingMovement && (
      <div className="modal-backdrop" role="presentation" onClick={() => setEditingMovement(null)}>
        <form className="movement-form" onSubmit={saveMovementEdit} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div>
              <p className="eyebrow">MODIFICAR MOVIMIENTO</p>
              <h2>{editingMovement.installmentCount && editingMovement.installmentCount > 1 ? 'Editar compra en cuotas' : 'Editar operación'}</h2>
            </div>
            <button
              type="button"
              className="modal-close-x"
              aria-label="Cerrar modal"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditingMovement(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          {editingMovement.installmentCount && editingMovement.installmentCount > 1 && (
            <div className="installment-edit-box">
              <div className="form-grid">
                <label>
                  ¿Por qué cuota vas este mes?
                  <select
                    value={editInstallmentNumber}
                    onChange={(e) => {
                      const num = Number(e.target.value);
                      setEditInstallmentNumber(num);
                    }}
                  >
                    {Array.from({ length: editInstallmentCount }, (_, i) => i + 1).map((num) => (
                      <option key={num} value={num}>
                        Cuota {num} de {editInstallmentCount}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Total de cuotas
                  <select
                    value={isCustomEditInstallmentCount ? 'custom' : editInstallmentCount}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setIsCustomEditInstallmentCount(true);
                        setCustomEditCountInput(String(editInstallmentCount));
                      } else {
                        setIsCustomEditInstallmentCount(false);
                        const count = Number(e.target.value);
                        setEditInstallmentCount(count);
                        if (editInstallmentNumber > count) setEditInstallmentNumber(count);
                      }
                    }}
                  >
                    {PRESET_INSTALLMENT_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count} cuotas
                      </option>
                    ))}
                    <option value="custom">Personalizada (otra cantidad)…</option>
                  </select>
                </label>
              </div>
              {isCustomEditInstallmentCount && (
                <label style={{ marginTop: '8px' }}>
                  <span>Cantidad total de cuotas (2 a 120):</span>
                  <input
                    type="number"
                    min="2"
                    max="120"
                    value={customEditCountInput}
                    onChange={(e) => {
                      const valStr = e.target.value;
                      setCustomEditCountInput(valStr);
                      const parsed = parseInt(valStr, 10);
                      if (!isNaN(parsed) && parsed >= 2) {
                        const clamped = Math.min(120, parsed);
                        setEditInstallmentCount(clamped);
                        if (editInstallmentNumber > clamped) setEditInstallmentNumber(clamped);
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseInt(customEditCountInput, 10);
                      if (isNaN(parsed) || parsed < 2) {
                        setCustomEditCountInput('2');
                        setEditInstallmentCount(2);
                      } else if (parsed > 120) {
                        setCustomEditCountInput('120');
                        setEditInstallmentCount(120);
                      } else {
                        setCustomEditCountInput(String(parsed));
                        setEditInstallmentCount(parsed);
                      }
                    }}
                    placeholder="Ej. 7, 8, 14..."
                    autoFocus
                  />
                </label>
              )}
              <div className="installment-cuota-preview-hint">
                {editInstallmentNumber === 1
                  ? `Esta es la primera cuota. Quedarán ${editInstallmentCount - 1} cuotas en los próximos meses.`
                  : `En esta fecha estás en la cuota ${editInstallmentNumber} de ${editInstallmentCount}. Las cuotas anteriores se sincronizarán en los meses previos y las ${editInstallmentCount - editInstallmentNumber} restantes en los próximos.`}
              </div>
            </div>
          )}
          <label>
            Descripción
            <input
              name="description"
              required
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Ej. Verdulería o Compra"
            />
          </label>
          <div className="form-grid">
            <label>
              Moneda
              <select
                name="currency"
                value={editCurrency}
                onChange={(e) => setEditCurrency(e.target.value as 'ARS' | 'USD')}
              >
                <option value="ARS">Pesos (ARS)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </label>
            <label>
              Tipo
              <select
                name="kind"
                value={editKind}
                disabled={Boolean(editingMovement.installmentCount && editingMovement.installmentCount > 1)}
                onChange={(event) => {
                  const k = event.target.value as 'expense' | 'income';
                  setEditKind(k);
                  const firstCat = categories.find((c) => c.kind === k);
                  if (firstCat) setEditCategoryId(firstCat.id);
                }}
              >
                <option value="expense">Gasto</option>
                <option value="income">Ingreso</option>
              </select>
            </label>
          </div>
          <label>
            {editingMovement.installmentCount && editingMovement.installmentCount > 1
              ? `Monto por cuota (${editCurrency})`
              : `Monto (${editCurrency})`}
            <input
              name="amount"
              required
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={editAmount}
              onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
            />
          </label>
          {editingMovement.installmentCount && editingMovement.installmentCount > 1 && parseAmountNumber(editAmount) > 0 && (
            <div className="installment-calc-preview" style={{ marginTop: '-4px', marginBottom: '8px' }}>
              <small>Total de la compra ({editInstallmentCount} cuotas):</small>
              <strong>{formatMoney(Math.round(parseAmountNumber(editAmount) * editInstallmentCount * 100) / 100, editCurrency)}</strong>
            </div>
          )}
          <div className="form-grid">
            <label>
              Categoría
              <select
                name="categoryId"
                required
                value={editCategoryId}
                onChange={(event) => setEditCategoryId(event.target.value)}
              >
                <option value="" disabled>Seleccioná una categoría</option>
                {availableEditCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              Fecha
              <input
                name="date"
                required
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </label>
          </div>

          {editingMovement.installmentCount && editingMovement.installmentCount > 1 && editingMovement.installmentGroupId && (
            <label className="switch-row" style={{ marginTop: '2px', padding: '6px 0' }}>
              <span>
                <strong style={{ fontSize: '13px' }}>¿Aplicar cambios a todo el plan?</strong>
                <small style={{ fontSize: '13px', color: 'var(--muted)' }}>Actualiza el nombre, categoría y recalcula las fechas de todas las cuotas consecutivas.</small>
              </span>
              <input
                type="checkbox"
                checked={editApplyToAll}
                onChange={(e) => setEditApplyToAll(e.target.checked)}
              />
            </label>
          )}

          <div className="modal-actions-grid-3">
            <button
              type="button"
              className="modal-btn-delete"
              disabled={isSavingEdit}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const target = editingMovement;
                setEditingMovement(null);
                deleteMovement(target);
              }}
              aria-label="Eliminar movimiento"
            >
              Eliminar
            </button>
            <button
              type="button"
              className="modal-btn-cancel"
              disabled={isSavingEdit}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditingMovement(null)}
            >
              Cancelar
            </button>
            <button
              className="modal-btn-save"
              type="submit"
              disabled={isSavingEdit || !editCategoryId}
              onMouseDown={(e) => e.preventDefault()}
            >
              {isSavingEdit ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    )}

    {installmentDeletePrompt && (
      <div className="modal-backdrop" role="presentation" onClick={() => setInstallmentDeletePrompt(null)}>
        <div className="movement-form delete-plan-modal" role="dialog" aria-modal="true" aria-labelledby="delete-installments-title" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div>
            <p className="eyebrow" style={{ color: '#ea7172' }}>ELIMINAR CUOTAS</p>
            <h2 id="delete-installments-title">{installmentDeletePrompt.movement ? '¿Cómo querés eliminar este movimiento?' : '¿Eliminar compra en cuotas?'}</h2>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '8px 0 0' }}>
              <strong>{installmentDeletePrompt.movement?.title ?? installmentDeletePrompt.plan?.description}</strong>
              {installmentDeletePrompt.movement && installmentDeletePrompt.movement.installmentCount ? (
                <span> · Cuota {installmentDeletePrompt.movement.installmentNumber ?? 1} de {installmentDeletePrompt.movement.installmentCount}</span>
              ) : (
                <span> · Plan de {installmentDeletePrompt.plan?.installmentCount} cuotas</span>
              )}
            </p>
          </div>

          <div className="delete-options-list">
            {installmentDeletePrompt.movement && (
              <button
                type="button"
                className="delete-option-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void executeDeleteSingleInstallment(installmentDeletePrompt.movement!)}
              >
                <div>
                  <strong>Eliminar solo esta cuota</strong>
                  <small>Borra únicamente el pago de este mes ({formatMoney(installmentDeletePrompt.movement.amount, installmentDeletePrompt.movement.currency || activeCurrency)})</small>
                </div>
                <span>›</span>
              </button>
            )}

            <button
              type="button"
              className="delete-option-btn danger"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void executeDeleteFullPlan(installmentDeletePrompt.movement ?? installmentDeletePrompt.plan!)}
            >
              <div>
                <strong>Eliminar todo el plan de cuotas</strong>
                <small>Borra todas las cuotas de esta compra ({installmentDeletePrompt.movement?.installmentCount ?? installmentDeletePrompt.plan?.installmentCount} cuotas en total)</small>
              </div>
              <span>›</span>
            </button>
          </div>

          <div style={{ marginTop: '10px' }}>
            <button
              type="button"
              className="modal-btn-cancel"
              style={{ width: '100%' }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setInstallmentDeletePrompt(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )}

    {showBudgetModal && (
      <div className="modal-backdrop" role="presentation" onClick={() => setShowBudgetModal(false)}>
        <form className="movement-form" onSubmit={saveBudget} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div>
              <p className="eyebrow">PRESUPUESTO MENSUAL</p>
              <h2>{budget > 0 ? 'Modificar presupuesto' : 'Definir presupuesto'} de {labelForMonth(month)}</h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '4px 0 0' }}>
                {budget > 0 ? 'Actualizá o eliminá tu límite de gastos para este mes.' : 'Definí tu límite de gastos para este mes.'}
              </p>
            </div>
            <button
              type="button"
              className="modal-close-x"
              aria-label="Cerrar modal"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowBudgetModal(false)}
            >
              <Icon name="close" />
            </button>
          </div>

          <label>
            Monto límite mensual (ARS)
            <input
              name="budgetAmount"
              type="text"
              inputMode="decimal"
              required
              autoFocus
              placeholder="Ej. 150.000"
              value={budgetInput}
              onChange={(e) => setBudgetInput(formatAmountInput(e.target.value))}
            />
          </label>

          {parseAmountNumber(budgetInput) > 0 && (
            <div className="installment-calc-preview" style={{ height: 'auto', padding: '10px 14px', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--muted)' }}>
                <span>Gastado en {labelForMonth(month)}:</span>
                <strong style={{ color: 'var(--ink)' }}>{formatMoney(expenses, 'ARS')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #dce8e1' }}>
                <span>Disponible con este límite:</span>
                <strong style={{ color: parseAmountNumber(budgetInput) - expenses >= 0 ? 'var(--mint-dark)' : '#d32f2f' }}>
                  {formatMoney(parseAmountNumber(budgetInput) - expenses, 'ARS')}
                </strong>
              </div>
            </div>
          )}

          {budget > 0 ? (
            <div className="modal-actions-grid-3">
              <button
                type="button"
                className="modal-btn-delete"
                disabled={isSavingBudget}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowBudgetModal(false);
                  setShowDeleteBudgetConfirm(true);
                }}
                aria-label="Eliminar presupuesto"
              >
                Eliminar
              </button>
              <button
                type="button"
                className="modal-btn-cancel"
                disabled={isSavingBudget}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowBudgetModal(false)}
              >
                Cancelar
              </button>
              <button
                className="modal-btn-save"
                type="submit"
                disabled={isSavingBudget || parseAmountNumber(budgetInput) <= 0}
                onMouseDown={(e) => e.preventDefault()}
              >
                {isSavingBudget ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          ) : (
            <div className="modal-actions-grid-2">
              <button
                type="button"
                className="modal-btn-cancel"
                disabled={isSavingBudget}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowBudgetModal(false)}
              >
                Cancelar
              </button>
              <button
                className="modal-btn-save"
                type="submit"
                disabled={isSavingBudget || parseAmountNumber(budgetInput) <= 0}
                onMouseDown={(e) => e.preventDefault()}
              >
                {isSavingBudget ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </form>
      </div>
    )}

    {showDeleteBudgetConfirm && (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-budget-title"
        onClick={() => {
          setShowDeleteBudgetConfirm(false);
          setShowBudgetModal(true);
        }}
      >
        <div
          className="movement-form"
          style={{ maxWidth: '380px', textAlign: 'center', padding: '26px 20px', gap: '16px' }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="dialog-symbol"><Icon name="trash" size={32} /></div>
          <div>
            <p className="eyebrow" style={{ color: '#ea7172', marginBottom: '4px' }}>ELIMINAR PRESUPUESTO</p>
            <h2 id="delete-budget-title" style={{ margin: 0, fontSize: '19px', fontWeight: 800 }}>
              ¿Eliminar presupuesto de {labelForMonth(month)}?
            </h2>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.45 }}>
              Se borrará el límite de <strong>{formatMoney(budget, 'ARS')}</strong> fijado para este mes. El seguimiento de gastos continuará disponible sin límite.
            </p>
          </div>
          <div className="modal-actions-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              className="modal-btn-cancel"
              disabled={isSavingBudget}
              style={{
    cursor: 'pointer'
}}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowDeleteBudgetConfirm(false);
                setShowBudgetModal(true);
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="modal-btn-delete"
              disabled={isSavingBudget}
              style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
}}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void executeDeleteBudget()}
            >
              {isSavingBudget ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      </div>
    )}

    {showCategoryModal && (
      <div className="modal-backdrop" role="presentation" onClick={() => setShowCategoryModal(false)}>
        <div className="movement-form category-modal-container" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <div className="category-modal-header">
            <div>
              <p className="eyebrow">DISTRIBUCIÓN DE GASTOS</p>
              <h2>Gastos por categoría</h2>
              <p className="category-modal-subtitle">
                {labelForMonth(month)} · Total: <strong>{formatMoney(expenses, activeCurrency)}</strong>
              </p>
            </div>
            <button
              type="button"
              className="modal-close-x"
              aria-label="Cerrar modal"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowCategoryModal(false)}
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="category-modal-chart-box">
            <div className="donut-chart category-modal-donut" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={chartData.length > 1 ? 2 : 0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {chartData.map((entry) => {
                      const isSelected = expandedCategoryInModal === entry.name;
                      const hasSelection = Boolean(expandedCategoryInModal);
                      return (
                        <Cell
                          key={entry.name}
                          fill={categoryVisual(entry.name).color}
                          opacity={hasSelection ? (isSelected ? 1 : 0.22) : 1}
                          stroke={isSelected ? '#ffffff' : 'none'}
                          strokeWidth={isSelected ? 3 : 0}
                          style={{
                            transition: 'opacity 0.22s ease',
                            pointerEvents: 'none',
                          }}
                        />
                      );
                    })}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>{activeCurrency}</strong><span>{expandedCategoryInModal ? 'Categoría' : 'Total'}</span></div>
            </div>
            <strong className="chart-total">{formatMoney(expandedCategoryInModal ? chartData.find(c => c.name === expandedCategoryInModal)?.value ?? expenses : expenses, activeCurrency)}</strong>
            <p className="category-modal-hint">
              {expandedCategoryInModal
                ? 'Categoría seleccionada · Tocá de nuevo en la lista para volver al total'
                : 'Tocá una categoría de la lista para ver sus compras y resaltarla en el gráfico'}
            </p>
          </div>

          <div className="category-modal-list">
            {chartData.map((entry) => {
              const color = categoryVisual(entry.name).color;
              const percent = expenses ? Math.round((entry.value / expenses) * 100) : 0;
              const isExpanded = expandedCategoryInModal === entry.name;
              const catMovements = filteredMovements.filter((m) => m.kind === 'expense' && m.category === entry.name);

              return (
                <div key={entry.name} className={`category-modal-item ${isExpanded ? 'active' : ''}`}>
                  <div
                    className="category-modal-item-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedCategoryInModal(isExpanded ? null : entry.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setExpandedCategoryInModal(isExpanded ? null : entry.name);
                    }}
                  >
                    <div className="category-modal-row-main">
                      <div className="category-modal-left">
                        <i className="category-modal-dot" style={{ background: color }} />
                        <span className="category-modal-name">{entry.name}</span>
                        <span className="category-modal-count">
                          ({catMovements.length} {catMovements.length === 1 ? 'compra' : 'compras'})
                        </span>
                      </div>
                      <div className="category-modal-right">
                        <strong className="category-modal-amount">{formatMoney(entry.value, activeCurrency)}</strong>
                        <span className="category-modal-badge" style={{ background: `${color}18`, color }}>
                          {percent}%
                        </span>
                        <span className={`category-modal-chevron ${isExpanded ? 'open' : ''}`}>›</span>
                      </div>
                    </div>
                    <div className="category-modal-track">
                      <span style={{ width: `${percent}%`, background: color }} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="category-modal-sublist">
                      {catMovements.length === 0 ? (
                        <p className="category-modal-empty-msg">
                          No hay compras registradas en esta categoría.
                        </p>
                      ) : (
                        catMovements.map((m) => (
                          <div
                            key={m.id}
                            className="category-modal-movement"
                          >
                            <div className="category-modal-mov-info">
                              <span className="category-modal-mov-title">{m.title}</span>
                              <span className="category-modal-mov-date">
                                {formatMovementDate(m.date)}
                                {m.installmentCount && m.installmentCount > 1
                                  ? ` · Cuota ${m.installmentNumber ?? 1}/${m.installmentCount}`
                                  : ''}
                              </span>
                            </div>
                            <div className="category-modal-mov-right">
                              <b className="category-modal-mov-amount">−{formatMoney(m.amount, m.currency || activeCurrency)}</b>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="category-modal-footer">
            <button
              type="button"
              className="modal-btn-cancel"
              style={{
    width: '100%'
}}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowCategoryModal(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    )}

    <InstallAppModal
      isOpen={showIosModal || showDesktopModal}
      onClose={() => {
        setShowIosModal(false);
        setShowDesktopModal(false);
      }}
      isIos={showIosModal}
    />
  </main>;
}
