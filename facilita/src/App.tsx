import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Barcode,
    Check,
    CheckCircle2,
    ChevronRight,
    CircleHelp,
    ClipboardList,
    Download,
    Minus,
    Pencil,
    Plus,
    RefreshCw,
    Share2,
    Trash2,
    X,
} from 'lucide-react';
import { db, initializeDatabase, type Conference, type LocalProduct } from './database'
import { loadRemoteProducts, loadRemoteWorkLists, syncConferenceToCloud, syncPendingLocalConferences } from './cloudSync';
import { supabase, supabaseConfigured } from './supabaseClient';
import {
    isMoreThanYearsAhead,
    isPastDue,
    mergeDuplicateItems,
    normalizeBarcode,
    parseDueDate,
    type DateMode,
    type InventoryItem,
    type NewInventoryItem,
} from './domain';
import './App.css';

type ProductDraft = { barcode: string; name: string; unregistered: boolean }
type Screen = 'start' | 'session' | 'done' | 'account'

const AdminPanel = lazy(() => import('./AdminPanel'))

const staff = ['Eduardo', 'Leandro', 'Alan C', 'Alan B']
const sectors = ['Massas, Leite Pó e Aveias', 'Bolacha, Biscoitos, Café e Diet', 'Doces, Leites e Descartáveis', 'Bebidas']
const monthFormatSectors = ['Limpeza', 'Perfumaria']

function formatDate(date: string) {
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`))
}

function formatToday() {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date())
}

function getInitialDateMode(sector: string): DateMode {
    return monthFormatSectors.includes(sector) ? 'month' : 'day'
}

function supportsFileShare(): boolean {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    try {
        const probeFile = new File([], 'validade.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        return navigator.canShare({ files: [probeFile] })
    } catch {
        return false
    }
}

function App() {
    const [screen, setScreen] = useState<Screen>('start')
    const [accountReturnScreen, setAccountReturnScreen] = useState<Exclude<Screen, 'account'>>('start')
    const [staffName, setStaffName] = useState(staff[0])
    const [sector, setSector] = useState(sectors[0])
    const [dateMode, setDateMode] = useState<DateMode>('day')
    const [dateInput, setDateInput] = useState('')
    const [quantity, setQuantity] = useState(1)
    const [draft, setDraft] = useState<ProductDraft | null>(null)
    const [entries, setEntries] = useState<InventoryItem[]>([])
    const [editingId, setEditingId] = useState<string | null>(null)
    const [toast, setToast] = useState('')
    const [appError, setAppError] = useState('')
    const [databaseReady, setDatabaseReady] = useState(false)
    const [resumableConference, setResumableConference] = useState<Conference | null>(null)
    const [resumableItemCount, setResumableItemCount] = useState(0)
    const [pendingConferences, setPendingConferences] = useState<Conference[]>([])
    const [conference, setConference] = useState<Conference | null>(null)
    const [localProductCount, setLocalProductCount] = useState(0)
    const [manualBarcode, setManualBarcode] = useState('')
    const [online, setOnline] = useState(navigator.onLine)
    const [saving, setSaving] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [cloudUserId, setCloudUserId] = useState<string | null>(null)
    const [cloudRole, setCloudRole] = useState<'admin' | 'worker' | null>(null)
    const [cloudMessage, setCloudMessage] = useState('')
    const [activeStaff, setActiveStaff] = useState(staff)
    const [activeSectors, setActiveSectors] = useState(sectors)
    const saveLockRef = useRef(false)
    const dueDateInputRef = useRef<HTMLInputElement>(null)
    const unregisteredNameRef = useRef<HTMLInputElement>(null)

    const parsedDate = useMemo(() => parseDueDate(dateInput, dateMode), [dateInput, dateMode])
    const totalUnits = entries.reduce((sum, entry) => sum + entry.quantity, 0)
    const draftBarcode = draft?.barcode ?? null
    const draftIsUnregistered = draft?.unregistered ?? false

    useEffect(() => {
        let mounted = true
        const refreshNetworkStatus = () => setOnline(navigator.onLine)
        window.addEventListener('online', refreshNetworkStatus)
        window.addEventListener('offline', refreshNetworkStatus)

        async function loadLocalData() {
            try {
                await initializeDatabase()
                const [savedConference, finishedConferences, productsCount] = await Promise.all([
                    db.conferences.where('status').equals('inProgress').first(),
                    db.conferences.where('status').anyOf(['pending', 'received']).toArray(),
                    db.products.count(),
                ])
                if (!mounted) return
                setResumableConference(savedConference ?? null)
                setPendingConferences(finishedConferences.sort((left, right) => right.startedAt.localeCompare(left.startedAt)))
                if (savedConference) {
                    setResumableItemCount(await db.items.where('conferenceId').equals(savedConference.id).count())
                }
                setLocalProductCount(productsCount)
                setDatabaseReady(true)
            } catch {
                if (mounted) {
                    setAppError('Não foi possível abrir os dados deste aparelho. Atualize a página e tente novamente.')
                    setDatabaseReady(true)
                }
            }
        }

        void loadLocalData()
        return () => {
            mounted = false
            window.removeEventListener('online', refreshNetworkStatus)
            window.removeEventListener('offline', refreshNetworkStatus)
        }
    }, [])

    useEffect(() => {
        if (!supabase) return
        let mounted = true
        void supabase.auth.getSession().then(({ data }) => {
            if (mounted) setCloudUserId(data.session?.user.id ?? null)
        })
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setCloudUserId(session?.user.id ?? null)
            if (!session) setCloudRole(null)
        })
        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])

    useEffect(() => {
        if (!supabase || !cloudUserId) return
        let mounted = true
        void supabase.from('profiles').select('role').eq('id', cloudUserId).maybeSingle().then(async ({ data }) => {
            if (!mounted || (data?.role !== 'admin' && data?.role !== 'worker')) return
            setCloudRole(data.role)
            try {
                const [workLists, remoteProducts] = await Promise.all([loadRemoteWorkLists(), loadRemoteProducts()])
                if (!mounted) return
                if (workLists.sectors.length > 0) setActiveSectors(workLists.sectors)
                if (workLists.repositors.length > 0) setActiveStaff(workLists.repositors)
                if (remoteProducts.length > 0) {
                    await db.products.bulkPut(remoteProducts)
                    setLocalProductCount(await db.products.count())
                }
            } catch {
                if (mounted) setCloudMessage('Não foi possível atualizar a cópia local de setores, repositores e produtos.')
            }
        })
        return () => { mounted = false }
    }, [cloudUserId, online])

    useEffect(() => {
        if (!draftBarcode) return
        const frameId = requestAnimationFrame(() => {
            const input = draftIsUnregistered ? unregisteredNameRef.current : dueDateInputRef.current
            input?.focus()
        })
        return () => cancelAnimationFrame(frameId)
    }, [draftBarcode, draftIsUnregistered, editingId])

    useEffect(() => {
        if (!online || !cloudUserId) return
        let mounted = true
        void syncPendingLocalConferences().then(({ synced, message }) => {
            if (!mounted) return
            if (synced.length > 0) {
                setPendingConferences((current) => current.map((item) => synced.find((entry) => entry.id === item.id) ?? item))
                setConference((current) => current ? synced.find((entry) => entry.id === current.id) ?? current : current)
            }
            if (message) setCloudMessage(message)
        }).catch(() => {
            if (mounted) setCloudMessage('Falha de conexão. As conferências continuam salvas e serão reenviadas depois.')
        })
        return () => { mounted = false }
    }, [online, cloudUserId])

    function notify(message: string) {
        setToast(message)
        window.setTimeout(() => setToast(''), 2600)
    }

    function openAccount() {
        setAccountReturnScreen(screen === 'account' ? 'start' : screen)
        setScreen('account')
    }

    async function loadConferenceItems(conferenceId: string) {
        const savedItems = await db.items.where('conferenceId').equals(conferenceId).toArray()
        savedItems.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        setEntries(savedItems)
    }

    async function beginConference() {
        if (!databaseReady) return
        setAppError('')
        const newConference: Conference = {
            id: crypto.randomUUID(),
            staffName,
            sector,
            startedAt: new Date().toISOString(),
            status: 'inProgress',
        }
        try {
            await db.conferences.add(newConference)
            setConference(newConference)
            setResumableConference(newConference)
            setResumableItemCount(0)
            setEntries([])
            setDraft(null)
            setDateMode(getInitialDateMode(sector))
            setScreen('session')
        } catch {
            setAppError('Não foi possível iniciar a conferência. Verifique o espaço disponível neste aparelho.')
        }
    }

    async function resumeConference(savedConference: Conference) {
        setAppError('')
        try {
            setConference(savedConference)
            setStaffName(savedConference.staffName)
            setSector(savedConference.sector)
            setDateMode(getInitialDateMode(savedConference.sector))
            await loadConferenceItems(savedConference.id)
            setDraft(null)
            setScreen('session')
        } catch {
            setAppError('Não foi possível retomar a conferência salva neste aparelho.')
        }
    }

    async function selectProductByBarcode(rawBarcode: string): Promise<boolean> {
        const barcode = normalizeBarcode(rawBarcode)
        if (!barcode) {
            setAppError('Código inválido: use 8 dígitos (EAN-8) ou 12/13 dígitos (UPC-A/EAN-13) com dígito verificador correto. Número aleatório não passa na validação.')
            return false
        }

        setAppError('')
        try {
            const product: LocalProduct | undefined = await db.products.get(barcode)
            setDraft({
                barcode,
                name: product?.name ?? '',
                unregistered: !product,
            })
            setDateInput('')
            setQuantity(1)
            setEditingId(null)
            setManualBarcode('')
            return true
        } catch {
            setAppError('Não foi possível consultar a base salva neste aparelho. Tente novamente.')
            return false
        }
    }

    function editEntry(entry: InventoryItem) {
        setDraft({ barcode: entry.barcode, name: entry.name, unregistered: entry.unregistered })
        const editDateMode = getInitialDateMode(sector)
        setDateMode(editDateMode)
        const [year, month, day] = entry.dueDate.split('-')
        setDateInput(editDateMode === 'month' ? `${month}${year}` : `${day}${month}${year.slice(-2)}`)
        setQuantity(entry.quantity)
        setEditingId(entry.id)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    async function saveEntry() {
        if (!conference || !draft || !parsedDate || quantity < 1 || (draft.unregistered && !draft.name.trim())) return
        if (quantity > 999 && !window.confirm('A quantidade passou de 999 unidades. Confirma este valor?')) return
        if (isMoreThanYearsAhead(parsedDate, 5) && !window.confirm('A validade está a mais de 5 anos. Confirme se a data está correta.')) return

        if (saveLockRef.current) return
        saveLockRef.current = true
        setSaving(true)

        const newItem: NewInventoryItem = {
            id: editingId ?? undefined,
            conferenceId: conference.id,
            barcode: draft.barcode,
            name: draft.name.trim(),
            quantity,
            dueDate: parsedDate,
            unregistered: draft.unregistered,
        }

        try {
            if (editingId) {
                const originalItem = entries.find((entry) => entry.id === editingId)
                const currentItems = await db.items.where('conferenceId').equals(conference.id).toArray()
                const result = mergeDuplicateItems(currentItems.filter((item) => item.id !== editingId), {
                    ...newItem,
                    id: undefined,
                    createdAt: originalItem?.createdAt,
                })
                await db.transaction('rw', db.items, async () => {
                    await db.items.put(result.merged
                        ? result.savedItem
                        : { ...result.savedItem, id: editingId, createdAt: originalItem?.createdAt ?? result.savedItem.createdAt })
                    if (result.merged) await db.items.delete(editingId)
                })
                notify(result.merged ? 'Validade repetida: quantidade somada' : 'Alterações salvas neste aparelho')
            } else {
                let wasMerged = false
                await db.transaction('rw', db.items, async () => {
                    const currentItems = await db.items.where('conferenceId').equals(conference.id).toArray()
                    const result = mergeDuplicateItems(currentItems, newItem)
                    wasMerged = result.merged
                    await db.items.put(result.savedItem)
                })
                notify(wasMerged ? 'Validade repetida: quantidade somada' : 'Item salvo neste aparelho')
            }
            await loadConferenceItems(conference.id)
            navigator.vibrate?.(35)
            setDraft(null)
            setDateInput('')
            setQuantity(1)
            setEditingId(null)
        } catch {
            setAppError('O item não foi salvo. Mantenha esta tela aberta e tente salvar novamente.')
        } finally {
            saveLockRef.current = false
            setSaving(false)
        }
    }

    async function deleteEntry(item: InventoryItem) {
        try {
            await db.items.delete(item.id)
            if (conference) await loadConferenceItems(conference.id)
            notify('Produto removido da conferência')
        } catch {
            setAppError('Não foi possível remover o item. Tente novamente.')
        }
    }

    function leaveSession() {
        if (conference?.status === 'inProgress') setResumableConference(conference)
        setConference(null)
        setDraft(null)
        setScreen('start')
    }

    async function cancelConference(target: Conference) {
        let itemCount: number
        try {
            itemCount = await db.items.where('conferenceId').equals(target.id).count()
        } catch {
            setAppError('Não foi possível conferir os itens salvos. A sessão continua intacta.')
            return
        }
        const itemLabel = itemCount === 1 ? '1 item salvo' : `${itemCount} itens salvos`
        const confirmed = window.confirm(`Cancelar a conferência de ${target.sector} e apagar ${itemLabel}? Essa ação não pode ser desfeita.`)
        if (!confirmed) return

        try {
            await db.transaction('rw', db.conferences, db.items, async () => {
                await db.items.where('conferenceId').equals(target.id).delete()
                await db.conferences.delete(target.id)
            })
            setEntries([])
            setConference(null)
            setResumableConference(null)
            setResumableItemCount(0)
            setDraft(null)
            setEditingId(null)
            setDateInput('')
            setQuantity(1)
            setManualBarcode('')
            setAppError('')
            setScreen('start')
        } catch {
            setAppError('Não foi possível cancelar a conferência. Os itens continuam salvos neste aparelho.')
        }
    }

    async function openPendingConference(savedConference: Conference) {
        setAppError('')
        try {
            setConference(savedConference)
            setStaffName(savedConference.staffName)
            setSector(savedConference.sector)
            await loadConferenceItems(savedConference.id)
            setScreen('done')
        } catch {
            setAppError('Não foi possível abrir esta planilha salva. Tente novamente.')
        }
    }

    function downloadSpreadsheet(file: File) {
        const url = URL.createObjectURL(file)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    }

    async function finishConference() {
        if (!conference || entries.length === 0 || exporting) return
        setExporting(true)
        setAppError('')
        try {
            const { createSpreadsheetFile } = await import('./spreadsheet')
            const { file } = createSpreadsheetFile(conference, entries)
            const exportedAt = new Date().toISOString()
            let finalizedConference: Conference = {
                ...conference,
                status: 'pending',
                finalizedAt: exportedAt,
                spreadsheetExportedAt: exportedAt,
            }
            await db.transaction('rw', db.conferences, async () => {
                await db.conferences.put(finalizedConference)
            })
            downloadSpreadsheet(file)
            if (online && cloudUserId) {
                const syncResult = await syncConferenceToCloud(finalizedConference.id)
                if (syncResult.ok) {
                    finalizedConference = syncResult.conference
                    setCloudMessage('Conferência enviada ao painel.')
                } else {
                    setCloudMessage(syncResult.message)
                }
            } else if (!supabaseConfigured) {
                setCloudMessage('Excel salvo. Configure o Supabase para enviar ao painel.')
            } else {
                setCloudMessage('Excel salvo. Entre na conta da loja para enviar ao painel.')
            }
            setConference(finalizedConference)
            setPendingConferences((current) => [
                finalizedConference,
                ...current.filter((item) => item.id !== finalizedConference.id),
            ])
            setResumableConference(null)
            setResumableItemCount(0)
            setScreen('done')
        } catch {
            setAppError('Não foi possível gerar o Excel. A conferência continua salva e pode ser retomada.')
        } finally {
            setExporting(false)
        }
    }

    async function exportPendingConference(method: 'download' | 'share') {
        if (!conference || exporting) return
        setExporting(true)
        setAppError('')
        try {
            const { createSpreadsheetFile } = await import('./spreadsheet')
            const { file } = createSpreadsheetFile(conference, entries)
            const canShareFile = typeof navigator.share === 'function'
                && typeof navigator.canShare === 'function'
                && navigator.canShare({ files: [file] })

            if (method === 'share' && canShareFile) {
                await navigator.share({
                    files: [file],
                    title: 'Planilha de validade',
                    text: `Conferência de ${conference.sector}`,
                })
            } else {
                downloadSpreadsheet(file)
                if (method === 'share') notify('Compartilhamento indisponível; planilha baixada neste aparelho.')
            }

            const updatedConference: Conference = {
                ...conference,
                status: conference.status === 'received' ? 'received' : 'pending',
                finalizedAt: conference.finalizedAt ?? new Date().toISOString(),
                spreadsheetExportedAt: new Date().toISOString(),
            }
            await db.conferences.put(updatedConference)
            setConference(updatedConference)
            setPendingConferences((current) => [
                updatedConference,
                ...current.filter((item) => item.id !== updatedConference.id),
            ])
            if (method === 'download') notify('Planilha Excel baixada neste aparelho.')
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                notify('Compartilhamento cancelado. A conferência continua salva.')
            } else {
                setAppError('Não foi possível gerar ou compartilhar o Excel. Tente baixar novamente.')
            }
        } finally {
            setExporting(false)
        }
    }

    if (screen === 'account') {
        return (
            <main className="app-shell admin-shell">
                <TopBar online={online} cloudRole={cloudRole} onAccountClick={openAccount} />
                <Suspense fallback={<div className="admin-loading">Abrindo painel…</div>}>
                    <AdminPanel userId={cloudUserId} role={cloudRole} onClose={() => setScreen(accountReturnScreen)} />
                </Suspense>
            </main>
        )
    }

    if (screen === 'start') {
        return (
            <main className="app-shell start-shell">
                <TopBar online={online} cloudRole={cloudRole} onAccountClick={openAccount} />
                <div className="start-content">
                    <div className="welcome-kicker"><span className="pulse-dot" /> CONFERÊNCIA DE VALIDADE</div>
                    <h1>Vamos deixar<br />tudo <em>em dia.</em></h1>
                    <p className="welcome-copy">Registre os produtos próximos do vencimento deste setor.</p>
                    {appError && <ErrorNotice message={appError} onClose={() => setAppError('')} />}
                    {cloudMessage && <div className="cloud-notice" role="status">{cloudMessage}</div>}
                    <section className="setup-panel" aria-label="Dados da conferência">
                        {resumableConference ? (
                            <>
                                <div className="resume-note"><RefreshCw size={18} /><div><strong>Conferência não finalizada</strong><span>{resumableConference.sector} · {resumableConference.staffName}</span></div></div>
                                <button className="button button-primary start-button" onClick={() => void resumeConference(resumableConference)}>
                                    Retomar conferência <ChevronRight size={20} strokeWidth={2.5} />
                                </button>
                                <p className="small-note">{resumableItemCount === 1 ? '1 item salvo neste aparelho.' : `${resumableItemCount} itens salvos neste aparelho.`}</p>
                                <button className="cancel-resumable-button" onClick={() => void cancelConference(resumableConference)}><Trash2 size={16} /> Cancelar esta conferência</button>
                            </>
                        ) : (
                            <>
                                <label className="field-label" htmlFor="staff">Quem está conferindo?</label>
                                <select id="staff" value={staffName} onChange={(event) => setStaffName(event.target.value)}>
                                    {activeStaff.map((name) => <option key={name}>{name}</option>)}
                                </select>
                                <label className="field-label second-label" htmlFor="sector">Setor</label>
                                <select id="sector" value={sector} onChange={(event) => setSector(event.target.value)}>
                                    {activeSectors.map((name) => <option key={name}>{name}</option>)}
                                </select>
                                <button className="button button-primary start-button" disabled={!databaseReady} onClick={() => void beginConference()}>
                                    {databaseReady ? 'Iniciar conferência' : 'Preparando dados locais…'} <ChevronRight size={20} strokeWidth={2.5} />
                                </button>
                            </>
                        )}
                    </section>
                    {pendingConferences.length > 0 && <section className="pending-sessions" aria-label="Planilhas desta sessão">
                        <div className="pending-heading"><div><span className="section-overline">ARQUIVOS DESTA LOJA</span><h2>Conferências finalizadas</h2></div><span>{pendingConferences.length}</span></div>
                        {pendingConferences.map((savedConference) => <article className="pending-session-row" key={savedConference.id}>
                            <div><strong>{savedConference.sector}</strong><span>{savedConference.staffName} · {formatDate(savedConference.startedAt.slice(0, 10))}</span><small>{savedConference.status === 'received' ? 'Enviada ao painel' : savedConference.spreadsheetExportedAt ? 'Planilha gerada · aguardando envio ao painel' : 'Planilha ainda não gerada'}</small></div>
                            <button className="icon-button" aria-label={`Abrir planilha de ${savedConference.sector}`} onClick={() => void openPendingConference(savedConference)}><ChevronRight size={19} /></button>
                        </article>)}
                    </section>}
                    <div className="start-note"><CheckCircle2 size={17} /> Conferência e itens ficam salvos neste aparelho</div>
                    {localProductCount > 0 && <div className="catalog-note">Base local de demonstração: {localProductCount} produtos. Produtos não encontrados podem ser identificados pelo nome.</div>}
                </div>
                <footer className="screen-footer"><span>FACILITA</span><span>PREVENÇÃO DE PERDAS · M3 · LEANDRO SOARES</span></footer>
            </main>
        )
    }

    if (screen === 'done') {
        return (
            <main className="app-shell done-shell">
                <TopBar online={online} cloudRole={cloudRole} onAccountClick={openAccount} />
                <div className="done-content">
                    <div className="done-mark"><Check size={38} /></div>
                    <div className="welcome-kicker">CONFERÊNCIA SALVA</div>
                    <h1>Está<br /><em>registrada.</em></h1>
                    <p className="welcome-copy">Sua planilha está pronta. O arquivo também pode ser baixado novamente ou compartilhado.</p>
                    {appError && <ErrorNotice message={appError} onClose={() => setAppError('')} />}
                    <div className="receipt">
                        <div><span>Setor</span><strong>{conference?.sector ?? sector}</strong></div>
                        <div><span>Repositor(a)</span><strong>{conference?.staffName ?? staffName}</strong></div>
                        <div><span>Produtos</span><strong>{entries.length} {entries.length === 1 ? 'item' : 'itens'} · {totalUnits} {totalUnits === 1 ? 'unidade' : 'unidades'}</strong></div>
                        <div className="receipt-status"><span>Planilha</span><strong><span className="status-dot" /> {conference?.spreadsheetExportedAt ? 'Gerada neste aparelho' : 'Pronta para gerar'}</strong></div>
                        <div className="receipt-status"><span>Envio ao painel</span><strong>{conference?.status === 'received' ? 'Enviado e confirmado' : cloudMessage || 'Pendente de conexão ou login'}</strong></div>
                    </div>
                    <button className="button button-primary export-button" disabled={exporting} onClick={() => void exportPendingConference('download')}>
                        <Download size={19} /> {exporting ? 'Preparando Excel…' : 'Baixar planilha Excel'}
                    </button>
                    {supportsFileShare() && <button className="button button-share export-button" disabled={exporting} onClick={() => void exportPendingConference('share')}>
                        {exporting ? <RefreshCw size={18} /> : <Share2 size={18} />} {exporting ? 'Preparando arquivo…' : 'Compartilhar planilha'}
                    </button>}
                    <button className="button button-primary start-button" onClick={() => { setConference(null); setScreen('start') }}>Voltar ao início <ChevronRight size={20} /></button>
                </div>
            </main>
        )
    }

    return (
        <main className="app-shell session-shell">
            <TopBar online={online} cloudRole={cloudRole} onAccountClick={openAccount} />
            <div className="session-heading">
                <button className="back-button" aria-label="Voltar para o início" title="Voltar para o início" onClick={leaveSession}><ArrowLeft size={20} /></button>
                <div><span className="section-overline">SESSÃO EM ANDAMENTO</span><h1>{conference?.sector ?? sector}</h1></div>
                <div className="session-counter"><ClipboardList size={17} /><span>{entries.length}</span></div>
                {conference && <button className="cancel-session-button" aria-label="Cancelar sessão" title="Cancelar sessão" onClick={() => void cancelConference(conference)}><Trash2 size={18} /></button>}
            </div>
            <div className="session-meta"><span>{conference?.staffName ?? staffName}</span><span className="meta-separator">/</span><span>{formatToday()}</span><span className="live-tag"><span className="pulse-dot" /> SALVO NO APARELHO</span></div>
            {appError && <ErrorNotice message={appError} onClose={() => setAppError('')} />}

            <div className="work-grid">
                <section className="capture-column" aria-label="Adicionar produto">
                    {!draft ? (
                        <form className="manual-code-panel" onSubmit={(event) => { event.preventDefault(); void selectProductByBarcode(manualBarcode) }}>
                            <div className="manual-code-heading"><Barcode size={22} /><div><strong>Código de barras</strong><span>EAN-8, UPC-A ou EAN-13 com dígito verificador</span></div></div>
                            <input
                                aria-label="Código de barras"
                                className="manual-code-input"
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={13}
                                value={manualBarcode}
                                onChange={(event) => setManualBarcode(event.target.value.replace(/\D/g, '').slice(0, 13))}
                                autoFocus
                            />
                            <div className="manual-code-actions">
                                <span className="code-entry-hint">O nome vem da base local. Para testar produto fora da base, use 036000291452.</span>
                                <button type="submit" className="button button-primary" disabled={!manualBarcode}>Validar código</button>
                            </div>
                        </form>
                    ) : (
                        <div className="entry-panel">
                            <div className="entry-panel-top"><span className="section-overline">{editingId ? 'EDITAR PRODUTO' : 'PRODUTO LIDO'}</span><button className="icon-button" aria-label="Cancelar edição" onClick={() => { setDraft(null); setEditingId(null); setAppError('') }}><X size={20} /></button></div>
                            <div className="product-identity">
                                <div className="product-icon"><Barcode size={23} /></div>
                                <div className="product-name-block">
                                    {draft.unregistered ? (
                                        <>
                                            <label className="field-label" htmlFor="unregistered-name">Produto fora da base</label>
                                            <input ref={unregisteredNameRef} id="unregistered-name" className="product-name-input" placeholder="Digite o nome do produto" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                                        </>
                                    ) : <h2>{draft.name}</h2>}
                                    <span className="barcode-text">{draft.barcode}</span>
                                </div>
                            </div>
                            {draft.unregistered && <div className="review-note"><CircleHelp size={16} /> Será marcado para revisão do administrador.</div>}

                            <div className="form-section">
                                <div className="form-title-row"><label className="field-label" htmlFor="due-date">Data de vencimento</label><span className="field-required">OBRIGATÓRIO</span></div>
                                <div className="segmented-control" role="group" aria-label="Formato da data">
                                    <button type="button" className={dateMode === 'day' ? 'segment active' : 'segment'} onClick={() => { setDateMode('day'); setDateInput('') }}>Dia definido</button>
                                    <button type="button" className={dateMode === 'month' ? 'segment active' : 'segment'} onClick={() => { setDateMode('month'); setDateInput('') }}>Mês / ano</button>
                                </div>
                                <div className="date-entry-row">
                                    <input
                                        id="due-date"
                                        ref={dueDateInputRef}
                                        aria-label="Data de vencimento"
                                        className="date-input"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        maxLength={6}
                                        placeholder={dateMode === 'day' ? 'DDMMAA' : 'MMAAAA'}
                                        value={dateInput}
                                        onChange={(event) => setDateInput(event.target.value.replace(/\D/g, '').slice(0, 6))}
                                    />
                                    <span className="format-hint">{dateMode === 'day' ? 'Ex.: 261026' : 'Ex.: 102026'}</span>
                                </div>
                                <div className={parsedDate ? 'date-preview valid' : 'date-preview'}>
                                    {parsedDate ? <><CheckCircle2 size={16} /> Vence em <strong>{formatDate(parsedDate)}</strong></> : <><CircleHelp size={16} /> {dateMode === 'day' ? 'Informe dia, mês e ano (6 números)' : 'Informe mês e ano (6 números)'}</>}
                                </div>
                            </div>

                            <div className="form-section quantity-section">
                                <div><span className="field-label">Quantidade</span><span className="quantity-help">Unidades com esta validade</span></div>
                                <div className="stepper" aria-label="Quantidade">
                                    <button aria-label="Diminuir quantidade" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus size={20} /></button>
                                    <input
                                        aria-label="Quantidade de unidades"
                                        className="quantity-input"
                                        type="number"
                                        inputMode="numeric"
                                        min="1"
                                        step="1"
                                        value={quantity || ''}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            if (value === '') {
                                                setQuantity(0)
                                                return
                                            }
                                            const parsedQuantity = Number(value)
                                            if (Number.isInteger(parsedQuantity) && parsedQuantity >= 1) setQuantity(parsedQuantity)
                                        }}
                                    />
                                    <button aria-label="Aumentar quantidade" onClick={() => setQuantity((value) => value + 1)}><Plus size={20} /></button>
                                </div>
                            </div>
                            <button className="button button-primary save-button" disabled={saving || !parsedDate || quantity < 1 || (draft.unregistered && !draft.name.trim())} onClick={() => void saveEntry()}>
                                <Check size={19} /> {saving ? 'Salvando no aparelho…' : editingId ? 'Salvar alterações' : 'Salvar produto'}
                            </button>
                            <button className="text-button change-product" onClick={() => { setDraft(null); setEditingId(null); setAppError('') }}>Cancelar e escanear outro produto</button>
                        </div>
                    )}
                </section>

                <section className="list-column" aria-label="Lista de produtos da sessão">
                    <div className="list-heading"><div><span className="section-overline">SEUS REGISTROS</span><h2>Conferência atual</h2></div><span className="item-count">{entries.length} {entries.length === 1 ? 'item' : 'itens'}</span></div>
                    {entries.length === 0 ? (
                        <div className="empty-list"><div className="empty-mark"><ClipboardList size={25} /></div><strong>Nenhum produto ainda</strong><span>Os produtos que salvar aparecem aqui.</span></div>
                    ) : (
                        <div className="entry-list">
                            {entries.map((entry) => (
                                <article className="entry-row" key={entry.id}>
                                    <div className="entry-row-main"><div className="entry-barcode"><Barcode size={16} /></div><div className="entry-info"><strong>{entry.name}</strong><span>{entry.barcode}</span><div className="entry-details"><span>Vence {formatDate(entry.dueDate)}</span><span className="detail-divider">·</span><span>{entry.quantity} un.</span></div><div className="entry-badges">{isPastDue(entry.dueDate) && <span className="expired-tag">VENCIDO</span>}{entry.unregistered && <span className="unregistered-tag">REVISAR</span>}</div></div></div>
                                    <div className="entry-actions"><button className="icon-button" aria-label={`Editar ${entry.name}`} onClick={() => editEntry(entry)}><Pencil size={17} /></button><button className="icon-button delete-button" aria-label={`Excluir ${entry.name}`} onClick={() => void deleteEntry(entry)}><Trash2 size={17} /></button></div>
                                </article>
                            ))}
                        </div>
                    )}
                    {entries.length > 0 && <div className="list-total"><span>Total nesta conferência</span><strong>{totalUnits} <small>{totalUnits === 1 ? 'unidade' : 'unidades'}</small></strong></div>}
                    <div className="list-tip"><span className="tip-symbol">i</span><span>Itens salvos permanecem neste aparelho. A mesma validade soma as quantidades.</span></div>
                </section>
            </div>

            <div className="session-bottom"><span>{entries.length === 0 ? 'Cada item salvo fica no aparelho' : `${entries.length} ${entries.length === 1 ? 'produto registrado' : 'produtos registrados'} · salvo localmente`}</span><button className="button button-finish" disabled={entries.length === 0 || saving || exporting} onClick={() => void finishConference()}>{exporting ? 'Gerando Excel…' : 'Finalizar e baixar Excel'} <ChevronRight size={19} /></button></div>
            {toast && <div className="toast" role="status"><CheckCircle2 size={18} /> {toast}</div>}
        </main>
    )
}

function TopBar({ online, cloudRole, onAccountClick }: { online: boolean; cloudRole: 'admin' | 'worker' | null; onAccountClick: () => void }) {
    return <header className="topbar"><a className="brand" href="#inicio" aria-label="Facilita início"><span className="brand-mark">f.</span><span>facilita<span className="brand-period">.</span></span></a><div className="topbar-right"><span className="topbar-status"><span className={online ? 'network-dot online' : 'network-dot'} />{online ? 'ONLINE' : 'SEM INTERNET'}<span className="prototype-label">M3 · SINCRONIZAÇÃO</span></span><button className="topbar-account" onClick={onAccountClick}>{cloudRole === 'admin' ? 'Painel' : cloudRole === 'worker' ? 'Conta da loja' : 'Acesso'}</button></div></header>
}

function ErrorNotice({ message, onClose }: { message: string; onClose: () => void }) {
    return <div className="error-notice" role="alert"><span>{message}</span><button type="button" aria-label="Fechar aviso" onClick={onClose}><X size={17} /></button></div>
}

export default App
