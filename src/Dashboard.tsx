import { Icon } from './Icons';
import { ModalDialog } from './ModalDialog';
import { useUpdateBlocker } from './PwaUpdates';
import { presentInstallmentPlans, type InstallmentPlanView } from './installmentPresentation';
import {
  filterMovementsList,
  groupMovementsByDay,
  normalizeDashboardSection,
  summarizeMonthlyInstallments,
} from './summaryPresentation';
import { categoryVisual, movementVisual } from './categoryVisuals';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { supabase } from './supabase';
import {
  INSTALLMENT_BOUNDS_ERROR,
  isValidInstallmentCount,
  isValidInstallmentSchedule,
  MAX_INSTALLMENT_COUNT,
  MIN_INSTALLMENT_COUNT,
  mutateInstallmentPlan,
  parseInstallmentCountInput,
  planError,
  planPatch,
  PRESET_INSTALLMENT_COUNTS,
  readInstallmentPlan,
  type PlanSnapshot,
} from './installmentPlans';
import { EntrySender, browserEntryStorage, entryError, type EntryAttempt, type EntryDraft } from './pwaEntries';
import { createDashboardLoader, canShowDashboard, type LoadView } from './dashboardLoader';
import * as dashboardDataModule from './dashboardData';
import type { DashboardQueryCache } from './dashboardData';
import { requestWhatsAppLinkCode } from './whatsappLink';
import { formatAmountInput, numberToAmountInput, parseAmountNumber, formatMoney } from '../lib/finance';
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

type InstallmentPlan = InstallmentPlanView;

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

const isPresetInstallmentCount = (count: number) => (PRESET_INSTALLMENT_COUNTS as readonly number[]).includes(count);
export const MOVEMENTS_PAGE_SIZE = 50;
const DASHBOARD_POLL_INTERVAL_MS =
  'DASHBOARD_POLL_INTERVAL_MS' in dashboardDataModule &&
  typeof dashboardDataModule.DASHBOARD_POLL_INTERVAL_MS === 'number'
    ? dashboardDataModule.DASHBOARD_POLL_INTERVAL_MS
    : 30_000;

function getDashboardQueryCache(userId: string): DashboardQueryCache {
  if (
    'createDashboardQueryCache' in dashboardDataModule &&
    typeof dashboardDataModule.createDashboardQueryCache === 'function'
  ) {
    return dashboardDataModule.createDashboardQueryCache(userId);
  }
  const fallback: DashboardQueryCache = {
    userId,
    invalidateInstallments() { delete fallback.installments; },
    invalidateMonths() { delete fallback.months; },
    invalidateBotState() { delete fallback.botState; },
    invalidateAll() {
      delete fallback.botPhone;
      delete fallback.supportPhone;
      delete fallback.botState;
      delete fallback.months;
      delete fallback.installments;
    },
  };
  return fallback;
}

function getTotalsByCurrency(
  items: ReadonlyArray<{ amount: number; currency?: 'ARS' | 'USD'; kind: 'expense' | 'income' }>,
  currency: 'ARS' | 'USD',
) {
  if (
    'computeTotalsByCurrency' in dashboardDataModule &&
    typeof dashboardDataModule.computeTotalsByCurrency === 'function'
  ) {
    return dashboardDataModule.computeTotalsByCurrency(items, currency);
  }
  let expenseCents = 0;
  let incomeCents = 0;
  for (const item of items) {
    if ((item.currency || 'ARS') !== currency) continue;
    const cents = Math.round(Number(item.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    if (item.kind === 'expense') expenseCents += cents;
    else if (item.kind === 'income') incomeCents += cents;
  }
  return {
    expenses: expenseCents / 100,
    income: incomeCents / 100,
    balance: (incomeCents - expenseCents) / 100,
  };
}

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
  const [supportPhone, setSupportPhone] = useState<string>('');
  const [waLinkReady, setWaLinkReady] = useState<{ url: string; code: string } | null>(null);
  const queryCache = useMemo(() => getDashboardQueryCache(userId), [userId]);

  const supportWhatsAppUrl = useMemo(() => {
    const rawPhone =
      supportPhone ||
      waBotNumber ||
      queryCache.supportPhone?.value ||
      queryCache.botPhone?.value ||
      '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const supportText = encodeURIComponent(
      userEmail
        ? `¡Hola! Necesito ayuda con mi cuenta de Pesito (${userEmail}).`
        : '¡Hola! Necesito ayuda con mi cuenta de Pesito.',
    );
    return cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${supportText}`
      : `https://wa.me/?text=${supportText}`;
  }, [supportPhone, waBotNumber, queryCache.supportPhone?.value, queryCache.botPhone?.value, userEmail]);

  async function handleConnectWhatsApp() {
    setIsConnectingWa(true);
    setOnboardingWaMsg(null);

    try {
      const { code: nextCode } = await requestWhatsAppLinkCode();

      let targetPhone = waBotNumber || queryCache.botPhone?.value || '';
      if (!targetPhone) {
        const { data: configData } = await supabase
          .from('system_config')
          .select('value')
          .eq('key', 'whatsapp_bot_phone')
          .maybeSingle();
        if (configData?.value) {
          targetPhone = String(configData.value);
          setWaBotNumber(targetPhone);
          queryCache.botPhone = { value: targetPhone, fetchedAt: Date.now() };
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
  const [dataContext, setDataContext] = useState<string | null>(null);
  const context = userId + ':' + month;
  const [readView, setReadView] = useState<LoadView>({ context, status: 'loading', refreshing: false });
  const [monthsWarning, setMonthsWarning] = useState(false);
  const financialReady = canShowDashboard(readView, context) && dataContext === context;
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();

    // Incluimos siempre el mes actual del calendario (ej. Septiembre 2026)
    if (currentMonth) monthsSet.add(currentMonth);

    // Incluimos siempre el mes que el usuario está consultando en pantalla
    if (month) monthsSet.add(month);

    // Incluimos todos los meses que tengan gastos/movimientos o cuotas registradas
    (dataContext?.startsWith(userId + ':') ? knownMonths : []).forEach((m) => {
      if (m && /^\d{4}-\d{2}$/.test(m)) monthsSet.add(m);
    });

    return Array.from(monthsSet).sort();
  }, [currentMonth, month, knownMonths, userId, dataContext]);

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
  const [movementsPage, setMovementsPage] = useState(1);
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
  const [budgetError, setBudgetError] = useState<string>('');
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
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(todayKey());
  const [pendingEntry, setPendingEntry] = useState<EntryAttempt | null>(null);
  const [entryMessage, setEntryMessage] = useState('');
  const [entryStorageIssue, setEntryStorageIssue] = useState('');
  const [categoryStatus, setCategoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const entrySender = useMemo(() => new EntrySender(userId, browserEntryStorage), [userId]);
  useEffect(() => {
    entrySender.activate();
    try { setPendingEntry(entrySender.pending()); setEntryStorageIssue(''); }
    catch (error) { setEntryStorageIssue(entryError(error)); }
    return () => entrySender.deactivate();
  }, [entrySender]);
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
  const [isAdding, setIsAdding] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [categoriesReloadNonce, setCategoriesReloadNonce] = useState(0);
  const [editPlan, setEditPlan] = useState<PlanSnapshot | null>(null);
  const [deletePlan, setDeletePlan] = useState<PlanSnapshot | null>(null);
  const [editPlanError, setEditPlanError] = useState('');
  const [deletePlanError, setDeletePlanError] = useState('');
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);
  useUpdateBlocker(showAdd || Boolean(editingMovement) || Boolean(installmentDeletePrompt) || showBudgetModal || showDeleteBudgetConfirm || showCategoryModal || isAdding || isSavingEdit || isSavingBudget || isDeletingPlan, "Guardá o cerrá el formulario de movimientos para actualizar.");

  const editBusy = useRef(false);
  const deleteBusy = useRef(false);
  const editRequest = useRef<string | null>(null);
  const deleteRequest = useRef<string | null>(null);
  const editingPlanId = editingMovement?.installmentGroupId;
  const editingItemId = editingMovement?.id;
  const deletingPlanId = installmentDeletePrompt?.plan?.groupId ?? installmentDeletePrompt?.movement?.installmentGroupId;
  const deletingRow = deletePlan?.rows.find(row => row.id === installmentDeletePrompt?.movement?.id);

  useEffect(() => {
    let active = true;
    setEditPlan(null);
    setEditPlanError('');
    if (editingPlanId && editingItemId) {
      void readInstallmentPlan(editingPlanId).then(snapshot => {
        if (!active) return;
        const row = snapshot.rows.find(row => row.id === editingItemId);
        if (!row) throw new Error('Esta cuota ya no está activa. Cerrá y volvé a abrir el plan.');
        setEditDescription(row.description);
        setEditAmount(numberToAmountInput(row.amount_ars));
        setEditCurrency(row.currency);
        setEditCategoryId(row.category_id ?? '');
        setEditDate(row.occurred_on);
        setEditInstallmentNumber(row.installment_number);
        setEditInstallmentCount(row.installment_count);
        setIsCustomEditInstallmentCount(!isPresetInstallmentCount(row.installment_count));
        setCustomEditCountInput(String(row.installment_count));
        setEditPlan(snapshot);
      }).catch(error => { if (active) setEditPlanError(planError(error)); });
    }
    return () => { active = false; };
  }, [editingPlanId, editingItemId]);

  useEffect(() => {
    let active = true;
    setDeletePlan(null);
    setDeletePlanError('');
    deleteRequest.current = null;
    if (deletingPlanId) {
      void readInstallmentPlan(deletingPlanId).then(snapshot => {
        if (active) setDeletePlan(snapshot);
      }).catch(error => { if (active) setDeletePlanError(planError(error)); });
    }
    return () => { active = false; };
  }, [deletingPlanId]);
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

  useEffect(() => {
    setMovementsPage(1);
  }, [month, activeCurrency, movementSearch, movementKindFilter, movementCategoryFilter]);

  const totalMovementsPages = Math.max(1, Math.ceil(searchedMovements.length / MOVEMENTS_PAGE_SIZE));
  const safeMovementsPage = Math.min(movementsPage, totalMovementsPages);
  const paginatedMovements = useMemo(() => {
    const start = (safeMovementsPage - 1) * MOVEMENTS_PAGE_SIZE;
    return searchedMovements.slice(start, start + MOVEMENTS_PAGE_SIZE);
  }, [searchedMovements, safeMovementsPage]);

  const groupedMovementsByDay = useMemo(
    () => groupMovementsByDay(paginatedMovements, todayKey()),
    [paginatedMovements],
  );

  const hasActiveMovementFilters =
    movementSearch.trim().length > 0 || movementKindFilter !== 'all' || movementCategoryFilter !== 'all';

  const installmentsSummary = useMemo(
    () => summarizeMonthlyInstallments(filteredMovements, filteredInstallmentPlans.length),
    [filteredMovements, filteredInstallmentPlans.length],
  );

  const currencyTotals = useMemo(
    () => getTotalsByCurrency(movements, activeCurrency),
    [movements, activeCurrency],
  );
  const expenses = currencyTotals.expenses;
  const income = currencyTotals.income;
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
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setCategoryStatus('loading');
    void (async () => {
      try {
        const { data, error } = await supabase.from('categories').select('id,name,kind')
          .eq('user_id', userId).eq('active', true).order('name').abortSignal(controller.signal);
        if (!active) return;
        if (error || !Array.isArray(data)) throw new Error('Categorías no disponibles');
        setCategories(data.map(category => ({ id: String(category.id), name: String(category.name), kind: category.kind as 'expense' | 'income' })));
        setCategoryStatus('ready');
      } catch { if (active) setCategoryStatus('error'); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [userId, categoriesReloadNonce]);

  useEffect(() => {
    if (!pendingEntry && !availableCategories.some((category) => category.id === categoryId)) {
      setCategoryId(availableCategories[0]?.id ?? '');
    }
  }, [availableCategories, categoryId, pendingEntry]);

  useEffect(() => {
    const loadContext = userId + ':' + month;
    const loader = createDashboardLoader({
      read: signal => dashboardDataModule.readDashboardSnapshot(userId, month, signal, supabase, { cache: queryCache }),
      start: () => setReadView(current => ({ context: loadContext,
        status: current.context === loadContext && current.status === 'ready' ? 'ready' : 'loading', refreshing: true })),
      commit: snapshot => {
        const transactions = { data: snapshot.transactions };
        const computedPlans = presentInstallmentPlans(snapshot.installments, month, todayKey());
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
        setBudget(snapshot.budget);
        setKnownMonths(snapshot.months);
        setMonthsWarning(snapshot.monthsWarning);
        setBotState(snapshot.botState);
        setWaBotNumber(snapshot.botPhone);
        setSupportPhone(snapshot.supportPhone ?? snapshot.botPhone);
        setInstallmentPlans(computedPlans);
        setDataContext(loadContext);
        setReadView({ context: loadContext, status: 'ready', refreshing: false });
      },
      fail: () => { setReadView({ context: loadContext, status: 'error', refreshing: false }); setBotState('unknown'); },
    });
    const refresh = () => { void loader.refresh(); };
    const onTransactionChange = () => {
      queryCache.invalidateInstallments();
      queryCache.invalidateMonths();
      refresh();
    };
    const onBotMetaChange = () => {
      queryCache.invalidateBotState();
      refresh();
    };
    refresh();
    const channel = supabase.channel('dashboard-' + userId + '-' + month)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: 'user_id=eq.' + userId }, onTransactionChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: 'user_id=eq.' + userId }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_links', filter: 'user_id=eq.' + userId }, onBotMetaChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'user_id=eq.' + userId }, onBotMetaChange)
      .subscribe();
    const pollIfActive = () => {
      if (document.visibilityState === 'hidden') return;
      if (typeof window.navigator !== 'undefined' && window.navigator.onLine === false) return;
      refresh();
    };
    const interval = window.setInterval(pollIfActive, DASHBOARD_POLL_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        queryCache.invalidateInstallments();
        queryCache.invalidateBotState();
        refresh();
      }
    };
    const refreshWhenOnline = () => {
      queryCache.invalidateAll();
      refresh();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenOnline);
    return () => {
      loader.stop();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenOnline);
      void supabase.removeChannel(channel);
    };
  }, [month, userId, refreshNonce, queryCache]);

  function refreshDashboard() {
    queryCache.invalidateInstallments();
    queryCache.invalidateMonths();
    queryCache.invalidateBotState();
    if (categoryStatus === 'error') {
      setCategoriesReloadNonce(n => n + 1);
    }
    setReadView({ context, status: 'loading', refreshing: false });
    setRefreshNonce(n => n + 1);
  }

  function openBudgetModal() {
    setBudgetError('');
    setBudgetInput(budget > 0 ? numberToAmountInput(budget) : '');
    setShowBudgetModal(true);
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBudgetError('');
    const next = parseAmountNumber(budgetInput);
    if (!Number.isFinite(next) || next <= 0) {
      setBudgetError('Ingresá un monto de presupuesto válido mayor a 0.');
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
      setBudgetError('No pudimos guardar el presupuesto. Intentá nuevamente.');
      return;
    }
    setBudget(next);
    setBudgetError('');
    refreshDashboard();
    setShowBudgetModal(false);
  }

  async function executeDeleteBudget() {
    if (budget <= 0) return;
    setBudgetError('');
    setIsSavingBudget(true);
    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('user_id', userId)
      .eq('month', `${month}-01`);

    setIsSavingBudget(false);
    if (error) {
      setBudgetError('No pudimos eliminar el presupuesto. Intentá nuevamente.');
      return;
    }
    setBudget(0);
    setBudgetInput('');
    setBudgetError('');
    refreshDashboard();
    setShowDeleteBudgetConfirm(false);
    setShowBudgetModal(false);
  }

  function restoreEntry(attempt: EntryAttempt) {
    const p = attempt.payload;
    setFormDescription(String(p.description)); setFormAmount(numberToAmountInput(Number(p.amount)));
    setManualCurrency(p.currency === 'USD' ? 'USD' : 'ARS');
    setManualKind(attempt.type === 'plan' ? 'expense' : p.kind as 'expense' | 'income');
    setCategoryId(String(p.category_id)); setFormDate(String(attempt.type === 'plan' ? p.reference_date : p.occurred_on));
    setIsInstallments(attempt.type === 'plan');
    if (attempt.type === 'plan') {
      const count = Number(p.installment_count);
      setInstallmentCount(count); setCurrentInstallmentNumber(Number(p.reference_number));
      setIsCustomInstallmentCount(!isPresetInstallmentCount(count)); setCustomCountInput(String(count));
      setInstallmentAmountMode(p.amount_mode === 'quota' ? 'quota' : 'total');
    }
  }

  function openAddForm() {
    if (entrySender.busy) return;
    setEntryMessage('');
    try {
      const pending = entrySender.pending();
      setPendingEntry(pending); setEntryStorageIssue('');
      if (pending) restoreEntry(pending); else if (!formDescription.trim() && !formAmount) setManualCurrency(activeCurrency);
    } catch (error) { setEntryStorageIssue(entryError(error)); }
    setShowAdd(true);
  }

  function closeAddForm() { if (!entrySender.busy) setShowAdd(false); }

  async function submitEntry(draft?: EntryDraft, cancel = false) {
    if (entrySender.busy) return;
    setIsAdding(true); setEntryMessage('');
    try {
      const completed = await entrySender.run(draft, cancel);
      if (!completed) return;
      setPendingEntry(null); setEntryStorageIssue('');
      if (completed.result.state === 'cancelled') {
        restoreEntry(completed.attempt);
        setEntryMessage('Envío cancelado. Podés corregir los datos y volver a guardar.');
      } else {
        const p = completed.attempt.payload;
        const targetMonth = String(completed.attempt.type === 'plan' ? p.reference_date : p.occurred_on).slice(0, 7);
        setKnownMonths(prev => Array.from(new Set([...prev, targetMonth])));
        setMonth(targetMonth); setActiveCurrency(p.currency === 'USD' ? 'USD' : 'ARS');
        setShowAdd(false); setIsInstallments(false); setInstallmentCount(3); setIsCustomInstallmentCount(false);
        setCustomCountInput('3'); setInstallmentAmountMode('total'); setCurrentInstallmentNumber(1);
        setFormAmount(''); setFormDescription(''); setFormDate(todayKey());
        setEntryMessage(completed.result.state === 'removed' ? 'Ese envío ya se había guardado y después se eliminó. No lo volvimos a crear.'
          : cancel ? 'El envío ya estaba guardado. Lo comprobamos sin duplicarlo.' : completed.result.replayed ? 'Envío comprobado. Se guardó una sola vez.' : 'Movimiento guardado.');
        refreshDashboard();
      }
    } catch (error) {
      setEntryMessage(entryError(error));
      try { setPendingEntry(entrySender.pending()); }
      catch (storageError) { setEntryStorageIssue(entryError(storageError)); }
    } finally { setIsAdding(false); }
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entrySender.busy || pendingEntry || entryStorageIssue) return;
    const selected = categories.find(category => category.id === categoryId && category.kind === manualKind);
    if (!selected) { setEntryMessage('Seleccioná una categoría válida.'); return; }
    let resolvedInstallmentCount = installmentCount;
    if (manualKind === 'expense' && isInstallments) {
      const parsedCount = isCustomInstallmentCount
        ? parseInstallmentCountInput(customCountInput)
        : (isValidInstallmentCount(installmentCount) ? installmentCount : null);
      if (parsedCount === null || !isValidInstallmentSchedule(parsedCount, currentInstallmentNumber)) {
        setEntryMessage(INSTALLMENT_BOUNDS_ERROR);
        return;
      }
      resolvedInstallmentCount = parsedCount;
    }
    const common = { description: formDescription.trim(), amount: parseAmountNumber(formAmount), currency: manualCurrency, category_id: selected.id };
    await submitEntry(manualKind === 'expense' && isInstallments
      ? { type: 'plan', payload: { ...common, amount_mode: installmentAmountMode, installment_count: resolvedInstallmentCount, reference_date: formDate, reference_number: currentInstallmentNumber } }
      : { type: 'movement', payload: { ...common, kind: manualKind, occurred_on: formDate } });
  }

  function startEditMovement(item: Movement) {
    if (editBusy.current) return;
    editRequest.current = null;
    setEditPlan(null);
    setEditPlanError('');
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
    const isCustom = !isPresetInstallmentCount(count);
    setIsCustomEditInstallmentCount(isCustom);
    setCustomEditCountInput(String(count));
    const num = Math.min(item.installmentNumber ?? 1, count);
    setEditInstallmentNumber(num);
    setEditApplyToAll(Boolean(item.installmentCount && item.installmentCount > 1));
  }

  async function saveMovementEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMovement || editBusy.current) return;
    setEditPlanError('');
    const description = editDescription.trim();
    const amount = parseAmountNumber(editAmount);
    if (!description || !Number.isFinite(amount) || amount <= 0 || !editDate) {
      setEditPlanError('Revisá descripción, categoría, importe, moneda y fecha.');
      return;
    }
    const selectedCategory = categories.find(c => c.id === editCategoryId && c.kind === editKind);
    if (!selectedCategory) {
      setEditPlanError('Seleccioná una categoría válida.');
      return;
    }
    editBusy.current = true;
    setIsSavingEdit(true);
    try {
      if (editingMovement.installmentCount && editingMovement.installmentCount > 1) {
        const original = editPlan?.rows.find(row => row.id === editingMovement.id);
        if (!editPlan || !original) throw new Error('Esperá a que termine de cargar el plan o volvé a abrirlo.');
        const resolvedEditCount = isCustomEditInstallmentCount
          ? parseInstallmentCountInput(customEditCountInput)
          : (isValidInstallmentCount(editInstallmentCount) ? editInstallmentCount : null);
        if (resolvedEditCount === null || !isValidInstallmentSchedule(resolvedEditCount, editInstallmentNumber)) {
          throw new Error(INSTALLMENT_BOUNDS_ERROR);
        }
        const payload = planPatch(original, { description, amount, currency: editCurrency,
          categoryId: selectedCategory.id, date: editDate, number: editInstallmentNumber, count: resolvedEditCount }, editApplyToAll);
        if (Object.keys(payload).length) {
          editRequest.current ??= crypto.randomUUID();
          const snapshot = await mutateInstallmentPlan({ requestId: editRequest.current, action: 'edit',
            groupId: editPlan.group_id, version: editPlan.version, itemId: original.id, payload, all: editApplyToAll });
          setKnownMonths(prev => Array.from(new Set([...prev, ...snapshot.rows.map(row => row.occurred_on.slice(0, 7))])));
        }
      } else {
        const { error } = await supabase.from('transactions').update({ description, amount_ars: amount,
          currency: editCurrency, kind: editKind, category_id: selectedCategory.id, occurred_on: editDate })
          .eq('id', editingMovement.id).eq('user_id', userId);
        if (error) throw error;
      }
      setEditingMovement(null);
      setKnownMonths(prev => Array.from(new Set([...prev, editDate.slice(0, 7)])));
      setMonth(editDate.slice(0, 7));
      refreshDashboard();
    } catch (error) {
      setEditPlanError(planError(error));
    } finally {
      editBusy.current = false;
      setIsSavingEdit(false);
    }
  }

  async function executeDeleteSingleMovement(item: Movement) {
    try {
      const { error } = await supabase.from('transactions').delete().eq('id', item.id).eq('user_id', userId);
      if (error) throw error;
      refreshDashboard();
    } catch { window.alert('No pudimos eliminar el movimiento. Intentá nuevamente.'); }
  }

  function deleteMovement(item: Movement) {
    if (item.installmentCount && item.installmentCount > 1) {
      setInstallmentDeletePrompt({ movement: item });
      return;
    }
    if (!window.confirm(`¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`)) return;
    void executeDeleteSingleMovement(item);
  }

  async function deleteInstallments(all: boolean, itemId?: string) {
    if (deleteBusy.current || !deletePlan || !deletePlan.rows.length) return;
    deleteBusy.current = true;
    setIsDeletingPlan(true);
    try {
      deleteRequest.current ??= crypto.randomUUID();
      await mutateInstallmentPlan({ requestId: deleteRequest.current,
        action: all ? 'delete_plan' : 'delete_installment', groupId: deletePlan.group_id,
        version: deletePlan.version, itemId: all ? undefined : itemId });
      setInstallmentDeletePrompt(null);
      refreshDashboard();
    } catch (error) {
      setDeletePlanError(planError(error));
    } finally {
      deleteBusy.current = false;
      setIsDeletingPlan(false);
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
          <a
            href={supportWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="support-whatsapp-btn"
            aria-label="Contactar a soporte por WhatsApp"
            title="Contactar a soporte por WhatsApp"
          >
            <Icon name="whatsapp" size={20} />
          </a>
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
                  style={{ background: 'var(--button-primary-bg)', color: 'var(--button-primary-ink)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
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
      {entryMessage && !showAdd && <p className="dashboard-notice" role="status">{entryMessage}</p>}
      {(pendingEntry || entryStorageIssue) && <div className="dashboard-notice" role="status">
        <p>{entryStorageIssue || 'Tenés un envío pendiente de comprobar. Revisalo antes de cargar otro movimiento.'}</p>
        <button className="button-secondary" type="button" onClick={openAddForm}>Revisar envío</button>
      </div>}
      {!financialReady ? <section className="panel dashboard-load-state" role={readView.context === context && readView.status === 'error' ? 'alert' : 'status'}>
        <h2>{readView.context === context && readView.status === 'error' ? 'No pudimos cargar ' : 'Cargando '}{labelForMonth(month).toLowerCase()}</h2>
        {readView.context === context && readView.status === 'error' && <><p>No mostramos saldos ni totales hasta recuperar todos los datos del mes.</p><button className="button-secondary" type="button" onClick={refreshDashboard}>Reintentar</button></>}
      </section> : <>
      {readView.refreshing && <p className="dashboard-refresh-status" role="status">Actualizando datos…</p>}
      {monthsWarning && <div className="dashboard-notice" role="status"><p>No pudimos cargar todos los meses del selector. Los datos del mes abierto están completos.</p><button className="text-button" type="button" onClick={refreshDashboard}>Reintentar meses</button></div>}
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
                    {searchedMovements.length > MOVEMENTS_PAGE_SIZE ? (
                      <>
                        Mostrando{' '}
                        <strong>
                          {(safeMovementsPage - 1) * MOVEMENTS_PAGE_SIZE + 1}–
                          {Math.min(safeMovementsPage * MOVEMENTS_PAGE_SIZE, searchedMovements.length)}
                        </strong>{' '}
                        de <strong>{searchedMovements.length}</strong> operaciones de {labelForMonth(month).toLowerCase()}
                      </>
                    ) : (
                      <>
                        Mostrando <strong>{searchedMovements.length}</strong>{' '}
                        {searchedMovements.length === 1 ? 'operación' : 'operaciones'} de {labelForMonth(month).toLowerCase()}
                      </>
                    )}
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
                {totalMovementsPages > 1 && (
                  <nav className="admin-pagination movements-pagination" aria-label="Paginación de movimientos">
                    <span className="admin-pagination-info">
                      Página <strong>{safeMovementsPage}</strong> de <strong>{totalMovementsPages}</strong>
                    </span>
                    <div className="admin-pagination-controls">
                      <button
                        type="button"
                        className="action-btn small secondary"
                        disabled={safeMovementsPage <= 1}
                        onClick={() => setMovementsPage((p) => Math.max(1, p - 1))}
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        className="action-btn small secondary"
                        disabled={safeMovementsPage >= totalMovementsPages}
                        onClick={() => setMovementsPage((p) => Math.min(totalMovementsPages, p + 1))}
                      >
                        Siguiente
                      </button>
                    </div>
                  </nav>
                )}
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
                <small>COMPRAS REGISTRADAS</small>
              </div>
              <strong>
                {installmentsSummary.activePlansCount}{' '}
                {installmentsSummary.activePlansCount === 1 ? 'compra' : 'compras'}
              </strong>
              <p>
                {upcomingPlans.length > 0
                  ? `${upcomingPlans.length} con próximo vencimiento programado`
                  : 'Sin próximas fechas registradas'}
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
                {filteredInstallmentPlans.length === 1 ? 'compra' : 'compras'}
              </span>
            </div>

            {filteredInstallmentPlans.length === 0 ? (
              <div className="budget-empty installments-empty-state">
                <span className="summary-empty-icon"><Icon name="card" size={24} /></span>
                <strong>No hay compras con cuotas desde {labelForMonth(month).toLowerCase()} en {activeCurrency}</strong>
                <p>Cuando registres una compra en cuotas, vas a poder seguir su progreso y próximos vencimientos acá.</p>
              </div>
            ) : (
              <div className="installments-list installments-dedicated-list">
                {filteredInstallmentPlans.map((plan) => {
                  const targetMov = plan.nextScheduled ?? plan.currentMovement;
                  const shownQuotaNum = targetMov.installmentNumber;
                  const shownQuotaAmount = targetMov.amount;
                  const catName = targetMov?.category ?? 'Compras';
                  const vis = categoryVisual(catName);
                  const progressPct = plan.progressPercent;
                  const isMenuOpen = openInstallmentMenuId === plan.groupId;

                  return (
                    <div className="installment-item installment-plan-card" data-installment-group={plan.groupId} key={plan.groupId}>
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
                              : `Fecha registrada: ${formatMovementDate(plan.currentMovement.date)}`}
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
                        aria-label={`${plan.earlierCount} de ${plan.activeCount} fechas registradas anteriores al corte`}
                        aria-valuemin={0}
                        aria-valuemax={plan.activeCount}
                        aria-valuenow={plan.earlierCount}
                      >
                        <div className="installment-progress-fill" style={{ width: `${progressPct}%` }} />
                      </div>
                      <div className="installment-plan-meta">
                        <span>
                          {plan.scheduledCount > 0
                            ? <>{plan.scheduledFrom === todayKey() ? 'Desde hoy' : `Desde ${formatScheduledDate(plan.scheduledFrom)}`}: {plan.scheduledCount} {plan.scheduledCount === 1 ? 'cuota' : 'cuotas'} · <strong>{formatMoney(plan.scheduledTotal, plan.currency)}</strong></>
                            : 'Sin próximas fechas registradas'}
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
                <div className="installment-item" data-installment-group={plan.groupId} key={plan.groupId}>
                  <div className="installment-header">
                    <div className="installment-info-col">
                      <span className="installment-date">Próxima · {formatScheduledDate(plan.nextScheduled!.date)}</span>
                      <strong className="installment-title">{plan.description}</strong>
                      <small className="installment-subtitle">{plan.scheduledCount} {plan.scheduledCount === 1 ? 'cuota programada' : 'cuotas programadas'} · {formatMoney(plan.scheduledTotal, plan.currency)}</small>
                    </div>
                    <div className="installment-amount-col">
                      <strong className="installment-amount">{formatMoney(plan.nextScheduled!.amount, plan.currency)}</strong>
                      <span className="installment-cuota-badge">Cuota {(plan.nextScheduled!.installmentNumber ?? 1)}/{plan.installmentCount}</span>
                    </div>
                  </div>
                  <div className="installment-progress-bar" aria-label={`${plan.earlierCount} de ${plan.activeCount} fechas registradas anteriores al corte`}>
                    <div
                      className="installment-progress-fill"
                      style={{ width: `${plan.progressPercent}%` }}
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
      </>}
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
      <button aria-label="Agregar movimiento" onClick={openAddForm}>
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
    <button className="desktop-add" onClick={openAddForm}><Icon name="plus" /> Agregar movimiento</button>
    {showAdd && (
      <ModalDialog
        as="form"
        open={showAdd}
        busy={isAdding || entrySender.busy}
        onClose={closeAddForm}
        titleId="add-movement-dialog-title"
        className="movement-form"
        noValidate
        onSubmit={addMovement}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <p className="eyebrow">{pendingEntry ? 'ENVÍO PENDIENTE' : 'NUEVO MOVIMIENTO'}</p>
            <h2 id="add-movement-dialog-title">{pendingEntry ? 'Comprobemos tu envío' : 'Registrá una operación'}</h2>
          </div>
          <button
            type="button"
            className="modal-close-x"
            aria-label="Cerrar modal"
            onMouseDown={(e) => e.preventDefault()}
            onClick={closeAddForm}
          >
            <Icon name="close" />
          </button>
        </div>
        {entryStorageIssue && <p role="alert" className="movement-form-alert">{entryStorageIssue}</p>}
        {categoryStatus !== 'ready' && <p role="status">{categoryStatus === 'loading' ? 'Cargando categorías…' : 'No pudimos cargar las categorías.'}{categoryStatus === 'error' && <button type="button" className="text-button" onClick={refreshDashboard}>Reintentar</button>}</p>}
        {pendingEntry && <div className="dashboard-notice"><p>Conservamos los datos del envío. Comprobarlo no lo duplica. Si ya se guardó, cancelar solo comprobará su estado.</p><div className="modal-actions-grid-2"><button type="button" className="button-secondary" disabled={isAdding} onClick={() => void submitEntry(undefined,true)}>Cancelar envío</button><button type="button" className="modal-btn-save" disabled={isAdding} onClick={() => void submitEntry()}>{isAdding ? 'Comprobando…' : 'Comprobar envío'}</button></div></div>}
        <fieldset disabled={isAdding || Boolean(pendingEntry) || Boolean(entryStorageIssue)} className="movement-fields">
        <label htmlFor="add-movement-description">
          Descripción
          <input id="add-movement-description" name="description" required maxLength={160} value={formDescription} onChange={event => setFormDescription(event.target.value)} placeholder="Ej. Verdulería o Compra en cuotas" />
        </label>
        <div className="form-grid">
          <label htmlFor="add-movement-currency">
            Moneda
            <select
              id="add-movement-currency"
              name="currency"
              value={manualCurrency}
              onChange={(e) => setManualCurrency(e.target.value as 'ARS' | 'USD')}
            >
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          </label>
          <label htmlFor="add-movement-kind">
            Tipo
            <select
              id="add-movement-kind"
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
            <label htmlFor="add-movement-amount" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
              {isInstallments && manualKind === 'expense'
                ? (installmentAmountMode === 'quota' ? `Monto por cuota (${manualCurrency})` : `Monto total de la compra (${manualCurrency})`)
                : `Monto (${manualCurrency})`}
            </label>
            {isInstallments && manualKind === 'expense' && (
              <div className="installment-mode-pills" role="group" aria-label="Modo de monto en cuotas">
                <button
                  type="button"
                  aria-pressed={installmentAmountMode === 'total'}
                  className={`mode-pill ${installmentAmountMode === 'total' ? 'active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setInstallmentAmountMode('total')}
                >
                  Monto total
                </button>
                <button
                  type="button"
                  aria-pressed={installmentAmountMode === 'quota'}
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
            id="add-movement-amount"
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
          <label htmlFor="add-movement-is-installments" className="switch-row" style={{ marginTop: '2px', padding: '6px 0' }}>
            <span>
              <strong style={{ fontSize: '13px' }}>¿Es una compra en cuotas?</strong>
              <small style={{ fontSize: '13px', color: 'var(--muted)' }}>Se crearán las cuotas para los próximos meses.</small>
            </span>
            <input
              id="add-movement-is-installments"
              type="checkbox"
              checked={isInstallments}
              onChange={(e) => setIsInstallments(e.target.checked)}
            />
          </label>
        )}
        {manualKind === 'expense' && isInstallments && (
          <>
            <div className="form-grid">
              <label htmlFor="add-movement-installment-count">
                Cantidad de cuotas
                <select
                  id="add-movement-installment-count"
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
              <label htmlFor="add-movement-current-installment">
                ¿Por qué cuota vas?
                <select
                  id="add-movement-current-installment"
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
              <label htmlFor="add-movement-custom-installment-count" style={{ marginTop: '-4px' }}>
                <span>Ingresá el número de cuotas ({MIN_INSTALLMENT_COUNT} a {MAX_INSTALLMENT_COUNT}):</span>
                <input
                  id="add-movement-custom-installment-count"
                  name="customInstallmentCount"
                  type="number"
                  min={MIN_INSTALLMENT_COUNT}
                  max={MAX_INSTALLMENT_COUNT}
                  step="1"
                  inputMode="numeric"
                  aria-invalid={parseInstallmentCountInput(customCountInput) === null}
                  aria-describedby={parseInstallmentCountInput(customCountInput) === null ? 'add-movement-custom-installment-error' : undefined}
                  className={parseInstallmentCountInput(customCountInput) === null ? 'input-invalid' : undefined}
                  value={customCountInput}
                  onChange={(e) => {
                    const valStr = e.target.value;
                    setCustomCountInput(valStr);
                    const parsed = parseInstallmentCountInput(valStr);
                    if (parsed !== null) {
                      setInstallmentCount(parsed);
                      if (currentInstallmentNumber > parsed) setCurrentInstallmentNumber(parsed);
                      if (entryMessage === INSTALLMENT_BOUNDS_ERROR) setEntryMessage('');
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseInstallmentCountInput(customCountInput);
                    if (parsed !== null) {
                      setCustomCountInput(String(parsed));
                      setInstallmentCount(parsed);
                      if (currentInstallmentNumber > parsed) setCurrentInstallmentNumber(parsed);
                    }
                  }}
                  placeholder="Ej. 7, 8, 14..."
                  autoFocus
                />
                {parseInstallmentCountInput(customCountInput) === null && (
                  <small id="add-movement-custom-installment-error" className="movement-field-error" role="status">
                    {INSTALLMENT_BOUNDS_ERROR}
                  </small>
                )}
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
          <label htmlFor="add-movement-category">
            Categoría
            <select
              id="add-movement-category"
              name="categoryId"
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="" disabled>Seleccioná una categoría</option>
              {pendingEntry && !availableCategories.some(category => category.id === categoryId) && <option value={categoryId}>Categoría original del envío</option>}
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label htmlFor="add-movement-date">
            {isInstallments && manualKind === 'expense' ? (currentInstallmentNumber > 1 ? `Fecha cuota ${currentInstallmentNumber}` : 'Fecha 1° cuota') : 'Fecha'}
            <input id="add-movement-date" name="date" required type="date" value={formDate} onChange={event => setFormDate(event.target.value)} />
          </label>
        </div>
        </fieldset>
        {entryMessage && <p role="alert" className="movement-form-alert">{entryMessage}</p>}
        <div className="modal-actions-grid-2">
          <button
            type="button"
            className="modal-btn-cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={closeAddForm}
          >
            Cerrar
          </button>
          {!pendingEntry && <button
            className="modal-btn-save"
            type="submit"
            disabled={isAdding || Boolean(pendingEntry) || Boolean(entryStorageIssue) || categoryStatus !== 'ready' || !categoryId}
            onMouseDown={(e) => e.preventDefault()}
          >
            {isAdding ? 'Guardando…' : 'Guardar'}
          </button>}
        </div>
      </ModalDialog>
    )}

    {editingMovement && (
      <ModalDialog
        as="form"
        open={Boolean(editingMovement)}
        busy={isSavingEdit || editBusy.current}
        ready={Boolean(!editingPlanId || editPlan || editPlanError)}
        onClose={() => { if (!editBusy.current) { setEditingMovement(null); setEditPlanError(''); } }}
        titleId="edit-movement-dialog-title"
        className="movement-form"
        noValidate
        onSubmit={saveMovementEdit}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <p className="eyebrow">MODIFICAR MOVIMIENTO</p>
            <h2 id="edit-movement-dialog-title">{editingMovement.installmentCount && editingMovement.installmentCount > 1 ? 'Editar compra en cuotas' : 'Editar operación'}</h2>
          </div>
          <button
            type="button"
            className="modal-close-x"
            aria-label="Cerrar modal"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (!editBusy.current) { setEditingMovement(null); setEditPlanError(''); } }}
          >
            <Icon name="close" />
          </button>
        </div>
        {editingPlanId && !editPlan && !editPlanError && <p role="status">Cargando cuotas…</p>}
        <fieldset disabled={isSavingEdit || Boolean(editingPlanId && !editPlan)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '14px' }}>
        {editingMovement.installmentCount && editingMovement.installmentCount > 1 && (
          <div className="installment-edit-box">
            <div className="form-grid">
              <label htmlFor="edit-movement-installment-number">
                ¿Por qué cuota vas este mes?
                <select
                  id="edit-movement-installment-number"
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
              <label htmlFor="edit-movement-installment-count">
                Total de cuotas
                <select
                  id="edit-movement-installment-count"
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
              <label htmlFor="edit-movement-custom-installment-count" style={{ marginTop: '8px' }}>
                <span>Cantidad total de cuotas ({MIN_INSTALLMENT_COUNT} a {MAX_INSTALLMENT_COUNT}):</span>
                <input
                  id="edit-movement-custom-installment-count"
                  name="customEditInstallmentCount"
                  type="number"
                  min={MIN_INSTALLMENT_COUNT}
                  max={MAX_INSTALLMENT_COUNT}
                  step="1"
                  inputMode="numeric"
                  aria-invalid={parseInstallmentCountInput(customEditCountInput) === null}
                  aria-describedby={parseInstallmentCountInput(customEditCountInput) === null ? 'edit-movement-custom-installment-error' : undefined}
                  className={parseInstallmentCountInput(customEditCountInput) === null ? 'input-invalid' : undefined}
                  value={customEditCountInput}
                  onChange={(e) => {
                    const valStr = e.target.value;
                    setCustomEditCountInput(valStr);
                    const parsed = parseInstallmentCountInput(valStr);
                    if (parsed !== null) {
                      setEditInstallmentCount(parsed);
                      if (editInstallmentNumber > parsed) setEditInstallmentNumber(parsed);
                      if (editPlanError === INSTALLMENT_BOUNDS_ERROR) setEditPlanError('');
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseInstallmentCountInput(customEditCountInput);
                    if (parsed !== null) {
                      setCustomEditCountInput(String(parsed));
                      setEditInstallmentCount(parsed);
                      if (editInstallmentNumber > parsed) setEditInstallmentNumber(parsed);
                    }
                  }}
                  placeholder="Ej. 7, 8, 14..."
                  autoFocus
                />
                {parseInstallmentCountInput(customEditCountInput) === null && (
                  <small id="edit-movement-custom-installment-error" className="movement-field-error" role="status">
                    {INSTALLMENT_BOUNDS_ERROR}
                  </small>
                )}
              </label>
            )}
            <div className="installment-cuota-preview-hint">
              Las fechas solo se reprograman si cambiás la fecha o la cuota de referencia. Se conservan los números de las cuotas existentes.
            </div>
          </div>
        )}
        <label htmlFor="edit-movement-description">
          Descripción
          <input
            id="edit-movement-description"
            name="description"
            required
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Ej. Verdulería o Compra"
          />
        </label>
        <div className="form-grid">
          <label htmlFor="edit-movement-currency">
            Moneda
            <select
              id="edit-movement-currency"
              name="currency"
              value={editCurrency}
              onChange={(e) => setEditCurrency(e.target.value as 'ARS' | 'USD')}
            >
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          </label>
          <label htmlFor="edit-movement-kind">
            Tipo
            <select
              id="edit-movement-kind"
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
        <label htmlFor="edit-movement-amount">
          {editingMovement.installmentCount && editingMovement.installmentCount > 1
            ? `Monto por cuota (${editCurrency})`
            : `Monto (${editCurrency})`}
          <input
            id="edit-movement-amount"
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
            <small>El monto solo se modifica si lo editás. Al aplicarlo a todo el plan, reemplaza el importe de cada cuota activa.</small>
          </div>
        )}
        <div className="form-grid">
          <label htmlFor="edit-movement-category">
            Categoría
            <select
              id="edit-movement-category"
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
          <label htmlFor="edit-movement-date">
            Fecha
            <input
              id="edit-movement-date"
              name="date"
              required
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
          </label>
        </div>

        {editingMovement.installmentCount && editingMovement.installmentCount > 1 && editingMovement.installmentGroupId && (
          <label htmlFor="edit-movement-apply-all" className="switch-row" style={{ marginTop: '2px', padding: '6px 0' }}>
            <span>
              <strong style={{ fontSize: '13px' }}>¿Aplicar cambios a todo el plan?</strong>
              <small style={{ fontSize: '13px', color: 'var(--muted)' }}>Solo cambia los campos que edites. Las cuotas eliminadas no se recuperan.</small>
            </span>
            <input
              id="edit-movement-apply-all"
              type="checkbox"
              checked={editApplyToAll}
              onChange={(e) => setEditApplyToAll(e.target.checked)}
            />
          </label>
        )}

        </fieldset>
        {editPlanError && <p role="alert" className="movement-form-alert">{editPlanError}</p>}
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
            onClick={() => { if (!editBusy.current) { setEditingMovement(null); setEditPlanError(''); } }}
          >
            Cancelar
          </button>
          <button
            className="modal-btn-save"
            type="submit"
            disabled={isSavingEdit || !editCategoryId || Boolean(editingPlanId && !editPlan)}
            onMouseDown={(e) => e.preventDefault()}
          >
            {isSavingEdit ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </ModalDialog>
    )}

    {installmentDeletePrompt && (
      <ModalDialog
        open={Boolean(installmentDeletePrompt)}
        busy={isDeletingPlan || deleteBusy.current}
        ready={Boolean(deletePlan || deletePlanError)}
        onClose={() => { if (!deleteBusy.current) setInstallmentDeletePrompt(null); }}
        titleId="delete-installments-title"
        descriptionId="delete-installments-desc"
        className="movement-form delete-plan-modal"
      >
        <div>
          <p className="eyebrow" style={{ color: '#ea7172' }}>ELIMINAR CUOTAS</p>
          <h2 id="delete-installments-title">{installmentDeletePrompt.movement ? '¿Cómo querés eliminar este movimiento?' : '¿Eliminar compra en cuotas?'}</h2>
          <p id="delete-installments-desc" style={{ fontSize: '13px', color: 'var(--muted)', margin: '8px 0 0' }}>
            <strong>{deletingRow?.description ?? deletePlan?.rows[0]?.description ?? installmentDeletePrompt.movement?.title ?? installmentDeletePrompt.plan?.description}</strong>
            {installmentDeletePrompt.movement && installmentDeletePrompt.movement.installmentCount ? (
              <span> · Cuota {installmentDeletePrompt.movement.installmentNumber ?? 1} de {installmentDeletePrompt.movement.installmentCount}</span>
            ) : (
              <span> · Plan de {installmentDeletePrompt.plan?.installmentCount} cuotas</span>
            )}
          </p>
        </div>

        {!deletePlan && !deletePlanError && <p role="status">Cargando cuotas…</p>}
        {deletePlan && <p>{deletePlan.rows.length} cuotas activas · {formatMoney(deletePlan.rows.reduce((sum, row) => sum + row.amount_ars, 0), deletePlan.rows[0]?.currency ?? activeCurrency)}</p>}
        {deletePlanError && <p role="alert">{deletePlanError}</p>}
        <div className="delete-options-list">
          {installmentDeletePrompt.movement && (
            <button
              type="button"
              className="delete-option-btn"
              onMouseDown={(e) => e.preventDefault()}
              disabled={isDeletingPlan || !deletingRow}
              onClick={() => void deleteInstallments(false, installmentDeletePrompt.movement!.id)}
            >
              <div>
                <strong>Eliminar solo esta cuota</strong>
                <small>Borra únicamente el pago de este mes ({formatMoney(deletingRow?.amount_ars ?? installmentDeletePrompt.movement.amount, deletingRow?.currency ?? installmentDeletePrompt.movement.currency ?? activeCurrency)})</small>
              </div>
              <span>›</span>
            </button>
          )}

          <button
            type="button"
            className="delete-option-btn danger"
            onMouseDown={(e) => e.preventDefault()}
            disabled={isDeletingPlan || !deletePlan?.rows.length}
            onClick={() => void deleteInstallments(true)}
          >
            <div>
              <strong>Eliminar todo el plan de cuotas</strong>
              <small>Elimina las cuotas activas de esta compra</small>
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
            onClick={() => { if (!deleteBusy.current) setInstallmentDeletePrompt(null); }}
          >
            Cancelar
          </button>
        </div>
      </ModalDialog>
    )}

    {showBudgetModal && (
      <ModalDialog
        as="form"
        open={showBudgetModal}
        busy={isSavingBudget}
        onClose={() => { if (!isSavingBudget) { setShowBudgetModal(false); setBudgetError(''); } }}
        titleId="budget-dialog-title"
        descriptionId="budget-dialog-desc"
        className="movement-form"
        onSubmit={saveBudget}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <p className="eyebrow">PRESUPUESTO MENSUAL</p>
            <h2 id="budget-dialog-title">{budget > 0 ? 'Modificar presupuesto' : 'Definir presupuesto'} de {labelForMonth(month)}</h2>
            <p id="budget-dialog-desc" style={{ color: 'var(--muted)', fontSize: '13px', margin: '4px 0 0' }}>
              {budget > 0 ? 'Actualizá o eliminá tu límite de gastos para este mes.' : 'Definí tu límite de gastos para este mes.'}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-x"
            aria-label="Cerrar modal"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (!isSavingBudget) { setShowBudgetModal(false); setBudgetError(''); } }}
          >
            <Icon name="close" />
          </button>
        </div>

        <label htmlFor="budget-amount-input">
          Monto límite mensual (ARS)
          <input
            id="budget-amount-input"
            name="budgetAmount"
            type="text"
            inputMode="decimal"
            required
            autoFocus
            placeholder="Ej. 150.000"
            value={budgetInput}
            onChange={(e) => {
              setBudgetInput(formatAmountInput(e.target.value));
              if (budgetError) setBudgetError('');
            }}
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

        {budgetError && <p role="alert" className="movement-form-alert">{budgetError}</p>}

        {budget > 0 ? (
          <div className="modal-actions-grid-3">
            <button
              type="button"
              className="modal-btn-delete"
              disabled={isSavingBudget}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setBudgetError('');
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
              onClick={() => { if (!isSavingBudget) { setShowBudgetModal(false); setBudgetError(''); } }}
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
              onClick={() => { if (!isSavingBudget) { setShowBudgetModal(false); setBudgetError(''); } }}
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
      </ModalDialog>
    )}

    {showDeleteBudgetConfirm && (
      <ModalDialog
        open={showDeleteBudgetConfirm}
        busy={isSavingBudget}
        onClose={() => {
          if (!isSavingBudget) {
            setBudgetError('');
            setShowDeleteBudgetConfirm(false);
            setShowBudgetModal(true);
          }
        }}
        titleId="delete-budget-title"
        descriptionId="delete-budget-desc"
        className="movement-form"
        style={{ maxWidth: '380px', textAlign: 'center', padding: '26px 20px', gap: '16px' }}
        initialFocusSelector=".modal-btn-cancel"
      >
        <div className="dialog-symbol"><Icon name="trash" size={32} /></div>
        <div>
          <p className="eyebrow" style={{ color: '#ea7172', marginBottom: '4px' }}>ELIMINAR PRESUPUESTO</p>
          <h2 id="delete-budget-title" style={{ margin: 0, fontSize: '19px', fontWeight: 800 }}>
            ¿Eliminar presupuesto de {labelForMonth(month)}?
          </h2>
          <p id="delete-budget-desc" style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.45 }}>
            Se borrará el límite de <strong>{formatMoney(budget, 'ARS')}</strong> fijado para este mes. El seguimiento de gastos continuará disponible sin límite.
          </p>
        </div>
        {budgetError && <p role="alert" className="movement-form-alert">{budgetError}</p>}
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
              setBudgetError('');
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
      </ModalDialog>
    )}

    {showCategoryModal && financialReady && (
      <ModalDialog
        open={Boolean(showCategoryModal && financialReady)}
        onClose={() => setShowCategoryModal(false)}
        titleId="category-dialog-title"
        descriptionId="category-dialog-desc"
        className="movement-form category-modal-container"
      >
        <div className="category-modal-header">
          <div>
            <p className="eyebrow">DISTRIBUCIÓN DE GASTOS</p>
            <h2 id="category-dialog-title">Gastos por categoría</h2>
            <p id="category-dialog-desc" className="category-modal-subtitle">
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
      </ModalDialog>
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
