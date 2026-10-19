import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import {
    ArrowDownToLine,
    ArrowLeft,
    Check,
    FileSpreadsheet,
    LogOut,
    Plus,
    RefreshCw,
    Upload,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { createConferenceSpreadsheet, workbookToBlob } from './spreadsheet'
import { normalizeBarcode, type InventoryItem } from './domain'
import type { Conference } from './database'
import { supabase } from './supabaseClient'
import './AdminPanel.css'

type Role = 'admin' | 'worker'
type RosterKind = 'sectors' | 'repositors'
type RemoteConference = {
    id: string
    sector_id: string
    repositor_id: string
    created_by: string
    started_at: string
    finalized_at: string
    received_at: string | null
    status: 'submitted' | 'received'
}
type RemoteItem = {
    id: string
    conference_id: string
    barcode: string
    name: string
    quantity: number
    due_date: string
    unregistered: boolean
    created_at: string
}
type RosterEntry = { id: string; name: string; active: boolean }

interface AdminPanelProps {
    userId: string | null
    role: Role | null
    onClose: () => void
}

function cleanHeader(value: unknown): string {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function dueGroup(date: string, referenceDay: number): string {
    const due = new Date(`${date}T00:00:00Z`).getTime()
    const days = Math.floor((due - referenceDay) / 86400000)
    if (days < 0) return 'Vencido'
    if (days <= 7) return 'Até 7 dias'
    if (days <= 15) return 'Até 15 dias'
    if (days <= 30) return 'Até 30 dias'
    return 'Mais de 30 dias'
}

function displayDate(value: string): string {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function currentTimestamp(): string {
    return new Date().toISOString()
}

function downloadFile(file: File): void {
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export default function AdminPanel({ userId, role, onClose }: AdminPanelProps) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [authBusy, setAuthBusy] = useState(false)
    const [busy, setBusy] = useState(false)
    const [errorMessage, setErrorMessage] = useState('')
    const [notice, setNotice] = useState('')
    const [conferences, setConferences] = useState<RemoteConference[]>([])
    const [items, setItems] = useState<RemoteItem[]>([])
    const [sectors, setSectors] = useState<RosterEntry[]>([])
    const [repositors, setRepositors] = useState<RosterEntry[]>([])
    const [sectorFilter, setSectorFilter] = useState('all')
    const [repositorFilter, setRepositorFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [dateFilter, setDateFilter] = useState('')
    const [newSector, setNewSector] = useState('')
    const [newRepositor, setNewRepositor] = useState('')
    const [reviewNames, setReviewNames] = useState<Record<string, string>>({})
    const [referenceDay] = useState(() => {
        const today = new Date()
        return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    })

    const loadAdminData = useCallback(async (showBusy = true, clearError = true) => {
        if (!supabase || role !== 'admin') return
        if (showBusy) setBusy(true)
        if (clearError) setErrorMessage('')
        try {
            const [conferenceResult, itemResult, sectorResult, repositorResult] = await Promise.all([
                supabase.from('conferences').select('id, sector_id, repositor_id, created_by, started_at, finalized_at, received_at, status').order('started_at', { ascending: false }),
                supabase.from('items').select('id, conference_id, barcode, name, quantity, due_date, unregistered, created_at').order('due_date'),
                supabase.from('sectors').select('id, name, active').order('name'),
                supabase.from('repositors').select('id, name, active').order('name'),
            ])
            if (conferenceResult.error || itemResult.error || sectorResult.error || repositorResult.error) {
                throw new Error('Não foi possível carregar os dados administrativos. Confira o banco e as permissões RLS.')
            }
            setConferences((conferenceResult.data ?? []) as RemoteConference[])
            setItems((itemResult.data ?? []) as RemoteItem[])
            setSectors((sectorResult.data ?? []) as RosterEntry[])
            setRepositors((repositorResult.data ?? []) as RosterEntry[])
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Falha ao carregar o painel.')
        } finally {
            if (showBusy) setBusy(false)
        }
    }, [role])

    const loadAdminDataOnEntry = useEffectEvent(() => loadAdminData(false, false))

    useEffect(() => {
        if (role !== 'admin') return
        const loadTimer = window.setTimeout(() => void loadAdminDataOnEntry(), 0)
        return () => window.clearTimeout(loadTimer)
    }, [role])

    async function signIn(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!supabase) return
        setAuthBusy(true)
        setErrorMessage('')
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        setAuthBusy(false)
        if (error || !data.user) {
            setErrorMessage('Não foi possível entrar. Confira e-mail e senha da conta da loja.')
            return
        }
    }

    async function signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
        onClose()
    }

    const sectorNames = useMemo(() => new Map(sectors.map((entry) => [entry.id, entry.name])), [sectors])
    const repositorNames = useMemo(() => new Map(repositors.map((entry) => [entry.id, entry.name])), [repositors])
    const conferencesById = useMemo(() => new Map(conferences.map((entry) => [entry.id, entry])), [conferences])
    const filteredConferences = useMemo(() => conferences.filter((entry) => {
        if (sectorFilter !== 'all' && entry.sector_id !== sectorFilter) return false
        if (repositorFilter !== 'all' && entry.repositor_id !== repositorFilter) return false
        if (statusFilter !== 'all' && entry.status !== statusFilter) return false
        if (dateFilter && entry.started_at.slice(0, 10) !== dateFilter) return false
        return true
    }), [conferences, sectorFilter, repositorFilter, statusFilter, dateFilter])
    const orderedItems = useMemo(() => [...items].sort((left, right) => left.due_date.localeCompare(right.due_date)), [items])
    const unknownItems = useMemo(() => {
        const unique = new Map<string, RemoteItem>()
        for (const item of items) if (item.unregistered && !unique.has(item.barcode)) unique.set(item.barcode, item)
        return [...unique.values()]
    }, [items])

    async function exportConference(conference: RemoteConference) {
        const sector = sectors.find((entry) => entry.id === conference.sector_id)?.name ?? 'Setor'
        const staffName = repositors.find((entry) => entry.id === conference.repositor_id)?.name ?? 'Repositor'
        const conferenceItems: InventoryItem[] = items
            .filter((item) => item.conference_id === conference.id)
            .map((item) => ({
                id: item.id,
                conferenceId: item.conference_id,
                barcode: item.barcode,
                name: item.name,
                quantity: item.quantity,
                dueDate: item.due_date,
                unregistered: item.unregistered,
                createdAt: item.created_at,
            }))
        const localConference: Conference = {
            id: conference.id,
            sector,
            staffName,
            startedAt: conference.started_at,
            finalizedAt: conference.finalized_at,
            receivedAt: conference.received_at ?? undefined,
            status: 'received',
        }
        const { workbook, filename } = createConferenceSpreadsheet(localConference, conferenceItems)
        const file = new File([workbookToBlob(workbook)], filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        downloadFile(file)
    }

    async function importProducts(event: React.ChangeEvent<HTMLInputElement>) {
        if (!supabase) return
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setBusy(true)
        setErrorMessage('')
        setNotice('')
        try {
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false })
            const sheet = workbook.Sheets[workbook.SheetNames[0]]
            if (!sheet) throw new Error('O arquivo não contém uma planilha.')
            const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
            if (rows.length === 0) throw new Error('A planilha não contém linhas.')
            const headers = (rows[0] ?? []).map(cleanHeader)
            const barcodeColumn = headers.findIndex((header) => /^(codigo|codigodebarras|barcode|ean|upc)$/.test(header))
            const nameColumn = headers.findIndex((header) => /^(descricao|nome|name|product|produto)$/.test(header))
            const hasHeaders = barcodeColumn >= 0 && nameColumn >= 0
            const codeIndex = hasHeaders ? barcodeColumn : 0
            const productNameIndex = hasHeaders ? nameColumn : 1
            const dataRows = hasHeaders ? rows.slice(1) : rows
            const byBarcode = new Map<string, { barcode: string; name: string; updated_at: string }>()
            let rejectedCount = 0

            for (const row of dataRows) {
                const barcode = normalizeBarcode(String(row[codeIndex] ?? ''))
                const name = String(row[productNameIndex] ?? '').trim()
                if (!barcode || !name) {
                    rejectedCount += 1
                    continue
                }
                byBarcode.set(barcode, { barcode, name, updated_at: currentTimestamp() })
            }
            const products = [...byBarcode.values()]
            if (products.length === 0) throw new Error('Nenhuma linha válida. Use código e descrição, nesta ordem, com códigos EAN válidos.')
            const { error } = await supabase.from('products').upsert(products, { onConflict: 'barcode' })
            if (error) throw new Error('A importação foi bloqueada. Confirme que esta conta tem perfil de administrador.')
            await loadAdminData()
            setNotice(`${products.length} produto(s) importado(s). ${rejectedCount} linha(s) inválida(s) ignorada(s).`)
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Não foi possível importar essa planilha.')
        } finally {
            setBusy(false)
        }
    }

    async function confirmUnknownProduct(item: RemoteItem) {
        if (!supabase) return
        const name = (reviewNames[item.barcode] ?? item.name).trim()
        const barcode = normalizeBarcode(item.barcode)
        if (!barcode || !name) {
            setErrorMessage('Informe uma descrição e confirme um código EAN válido.')
            return
        }
        setBusy(true)
        setErrorMessage('')
        try {
            const { error: productError } = await supabase.from('products').upsert({ barcode, name, updated_at: currentTimestamp() }, { onConflict: 'barcode' })
            if (productError) throw new Error('Não foi possível cadastrar o produto. Confira se a conta é administradora.')
            const { error: itemError } = await supabase.from('items').update({ name, unregistered: false }).eq('barcode', barcode).eq('unregistered', true)
            if (itemError) throw new Error('Produto incluído na base, mas não foi possível atualizar os itens antigos.')
            setNotice(`${name} entrou na base local do mercado.`)
            await loadAdminData()
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Falha ao confirmar o produto.')
        } finally {
            setBusy(false)
        }
    }

    async function saveRosterEntry(kind: RosterKind, name: string) {
        if (!supabase || !name.trim()) return
        setBusy(true)
        setErrorMessage('')
        try {
            const { error } = await supabase.from(kind).insert({ name: name.trim(), active: true })
            if (error) throw new Error('Não foi possível salvar. Confira se já existe e se a conta tem perfil de administrador.')
            if (kind === 'sectors') setNewSector('')
            else setNewRepositor('')
            await loadAdminData()
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Falha ao salvar cadastro.')
        } finally {
            setBusy(false)
        }
    }

    async function toggleRosterEntry(kind: RosterKind, entry: RosterEntry) {
        if (!supabase) return
        setBusy(true)
        setErrorMessage('')
        const { error } = await supabase.from(kind).update({ active: !entry.active }).eq('id', entry.id)
        setBusy(false)
        if (error) setErrorMessage('Não foi possível atualizar o cadastro.')
        else await loadAdminData()
    }

    if (!supabase) {
        return <section className="admin-panel">
            <button className="admin-back" onClick={onClose}><ArrowLeft size={18} /> Voltar</button>
            <div className="admin-empty"><h1>Conexão ainda não configurada</h1><p>O fluxo manual e as planilhas continuam funcionando neste aparelho. Para ativar painel e sincronização, configure a URL e a chave pública do Supabase em `.env.local`.</p></div>
        </section>
    }

    if (!userId) {
        return <section className="admin-panel">
            <button className="admin-back" onClick={onClose}><ArrowLeft size={18} /> Voltar</button>
            <div className="admin-auth">
                <div className="admin-kicker">FACILITA · ADMINISTRAÇÃO</div>
                <h1>Acessar conta</h1>
                <p>Use a conta compartilhada da loja ou a conta de administrador.</p>
                {errorMessage && <div className="admin-error" role="alert">{errorMessage}</div>}
                <form onSubmit={(event) => void signIn(event)}>
                    <label htmlFor="admin-email">E-mail</label>
                    <input id="admin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
                    <label htmlFor="admin-password">Senha</label>
                    <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                    <button className="button button-primary admin-submit" disabled={authBusy}>{authBusy ? 'Entrando…' : 'Entrar'}</button>
                </form>
            </div>
        </section>
    }

    if (role === 'worker') {
        return <section className="admin-panel">
            <div className="admin-header"><div><span className="admin-kicker">CONTA DA LOJA</span><h1>Conectada</h1></div><button className="icon-button" aria-label="Sair da conta" onClick={() => void signOut()}><LogOut size={18} /></button></div>
            <p className="admin-intro">As conferências serão sincronizadas quando houver conexão. O trabalho manual e as planilhas continuam disponíveis.</p>
            {notice && <div className="admin-notice" role="status">{notice}</div>}
            <button className="button button-primary" onClick={onClose}>Voltar à conferência</button>
        </section>
    }

    if (role !== 'admin') {
        return <section className="admin-panel"><div className="admin-empty"><h1>Perfil ainda não configurado</h1><p>Peça ao administrador para criar o perfil desta conta no Supabase. A conferência manual continua disponível.</p><button className="button button-primary" onClick={onClose}>Voltar ao app</button></div></section>
    }

    const knownConferenceIds = new Set(conferences.map((entry) => entry.id))
    const visibleItems = orderedItems.filter((item) => {
        const parent = conferencesById.get(item.conference_id)
        if (!parent) return false
        if (sectorFilter !== 'all' && parent.sector_id !== sectorFilter) return false
        if (repositorFilter !== 'all' && parent.repositor_id !== repositorFilter) return false
        if (statusFilter !== 'all' && parent.status !== statusFilter) return false
        if (dateFilter && parent.started_at.slice(0, 10) !== dateFilter) return false
        return knownConferenceIds.has(item.conference_id)
    })

    return <section className="admin-panel">
        <div className="admin-header"><div><span className="admin-kicker">FACILITA · ADMINISTRAÇÃO</span><h1>Conferências</h1></div><div className="admin-header-actions"><button className="icon-button" aria-label="Atualizar dados" onClick={() => void loadAdminData()}><RefreshCw size={18} /></button><button className="icon-button" aria-label="Sair da conta" onClick={() => void signOut()}><LogOut size={18} /></button></div></div>
        <div className="admin-toolbar">
            <label>Setor<select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}><option value="all">Todos</option>{sectors.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label>Repositor<select value={repositorFilter} onChange={(event) => setRepositorFilter(event.target.value)}><option value="all">Todos</option>{repositors.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label>Data<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="submitted">Reenvio pendente</option><option value="received">Recebidas</option></select></label>
        </div>
        {errorMessage && <div className="admin-error" role="alert">{errorMessage}</div>}
        {notice && <div className="admin-notice" role="status">{notice}</div>}
        {busy && <div className="admin-loading">Atualizando dados…</div>}

        <div className="admin-summary">{filteredConferences.length} conferência(s) · {visibleItems.length} item(ns)</div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Data</th><th>Setor</th><th>Repositor</th><th>Itens</th><th>Status</th><th>Arquivo</th></tr></thead><tbody>
            {filteredConferences.map((entry) => {
                const sessionItems = items.filter((item) => item.conference_id === entry.id)
                return <tr key={entry.id}><td>{displayDate(entry.started_at)}</td><td>{sectorNames.get(entry.sector_id) ?? 'Setor'}</td><td>{repositorNames.get(entry.repositor_id) ?? 'Repositor'}</td><td>{sessionItems.length}</td><td><span className={`admin-status status-${entry.status}`}>{entry.status === 'received' ? 'Recebida' : 'Reenvio pendente'}</span></td><td><button className="admin-export" onClick={() => void exportConference(entry)}><ArrowDownToLine size={16} /> Excel</button></td></tr>
            })}
            {filteredConferences.length === 0 && <tr><td className="admin-empty-cell" colSpan={6}>{busy ? 'Carregando…' : 'Nenhuma conferência corresponde aos filtros.'}</td></tr>}
        </tbody></table></div>

        <section className="admin-section"><div className="admin-section-heading"><div><span className="admin-kicker">VENCIMENTOS</span><h2>Itens em ordem de data</h2></div><span>{visibleItems.length}</span></div>
            {visibleItems.length === 0 ? <p className="admin-muted">Os itens das conferências filtradas aparecerão aqui.</p> : <div className="expiry-list">{visibleItems.map((item) => { const group = dueGroup(item.due_date, referenceDay); return <article className="expiry-row" key={item.id}><div className="expiry-date"><strong>{displayDate(item.due_date)}</strong><span className={`expiry-tag ${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{group}</span></div><div className="expiry-product"><strong>{item.name}</strong><span>{item.barcode} · {sectorNames.get(conferencesById.get(item.conference_id)?.sector_id ?? '') ?? 'Setor'}</span></div><strong className="expiry-quantity">{item.quantity} un.</strong></article> })}</div>}
        </section>

        <section className="admin-section"><div className="admin-section-heading"><div><span className="admin-kicker">REVISÃO</span><h2>Produtos fora da base</h2></div><span>{unknownItems.length}</span></div>
            {unknownItems.length === 0 ? <p className="admin-muted">Nenhum produto aguardando revisão.</p> : unknownItems.map((item) => <div className="review-row" key={item.barcode}><div><strong>{item.barcode}</strong><span>{items.filter((candidate) => candidate.barcode === item.barcode && candidate.unregistered).length} ocorrência(s) aguardando</span></div><input aria-label={`Descrição para ${item.barcode}`} value={reviewNames[item.barcode] ?? item.name} onChange={(event) => setReviewNames((current) => ({ ...current, [item.barcode]: event.target.value }))} /><button className="button button-primary" disabled={busy} onClick={() => void confirmUnknownProduct(item)}><Check size={16} /> Confirmar</button></div>)}
        </section>

        <section className="admin-section"><div className="admin-section-heading"><div><span className="admin-kicker">CATÁLOGO</span><h2>Importar produtos</h2></div><FileSpreadsheet size={20} /></div><p className="admin-muted">Selecione um Excel ou CSV com código de barras e descrição. Códigos serão validados e UPC-A normalizado.</p><label className="import-button"><Upload size={17} /> Selecionar arquivo<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void importProducts(event)} /></label></section>

        <div className="admin-management-grid">
            <RosterManager title="Setores" kind="sectors" entries={sectors} value={newSector} onChange={setNewSector} onSave={() => void saveRosterEntry('sectors', newSector)} onToggle={(entry) => void toggleRosterEntry('sectors', entry)} busy={busy} />
            <RosterManager title="Repositores" kind="repositors" entries={repositors} value={newRepositor} onChange={setNewRepositor} onSave={() => void saveRosterEntry('repositors', newRepositor)} onToggle={(entry) => void toggleRosterEntry('repositors', entry)} busy={busy} />
        </div>
    </section>
}

function RosterManager({ title, kind, entries, value, onChange, onSave, onToggle, busy }: {
    title: string
    kind: RosterKind
    entries: RosterEntry[]
    value: string
    onChange: (value: string) => void
    onSave: () => void
    onToggle: (entry: RosterEntry) => void
    busy: boolean
}) {
    return <section className="admin-section roster-section"><div className="admin-section-heading"><div><span className="admin-kicker">CADASTRO</span><h2>{title}</h2></div></div><form onSubmit={(event) => { event.preventDefault(); onSave() }}><input aria-label={`Novo ${kind === 'sectors' ? 'setor' : 'repositor'}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Nome do ${kind === 'sectors' ? 'setor' : 'repositor'}`} /><button className="button button-primary" disabled={busy || !value.trim()}><Plus size={16} /> Adicionar</button></form><div className="roster-list">{entries.map((entry) => <div className="roster-row" key={entry.id}><span>{entry.name}</span><button className={entry.active ? 'roster-toggle active' : 'roster-toggle'} disabled={busy} onClick={() => onToggle(entry)}>{entry.active ? 'Ativo' : 'Inativo'}</button></div>)}</div></section>
}
