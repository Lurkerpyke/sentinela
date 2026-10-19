import type { LocalProduct } from './database'
import { db, type Conference as LocalConference } from './database'
import type { InventoryItem } from './domain'
import { supabase } from './supabaseClient'

export type SyncResult =
    | { ok: true; conference: LocalConference }
    | { ok: false; message: string }

export async function syncConferenceToCloud(conferenceId: string): Promise<SyncResult> {
    if (!supabase) return { ok: false, message: 'Configure a conexão Supabase para enviar esta conferência.' }

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
        return { ok: false, message: 'Entre na conta da loja para enviar as conferências salvas.' }
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle()
    if (profileError || !profile) {
        return { ok: false, message: 'Esta conta ainda não foi configurada para usar o Facilita.' }
    }

    const conference: LocalConference | undefined = await db.conferences.get(conferenceId)
    if (!conference) return { ok: false, message: 'A conferência não foi encontrada neste aparelho.' }

    const [sectorResult, repositorResult, items] = await Promise.all([
        supabase.from('sectors').select('id').eq('name', conference.sector).eq('active', true).maybeSingle(),
        supabase.from('repositors').select('id').eq('name', conference.staffName).eq('active', true).maybeSingle(),
        db.items.where('conferenceId').equals(conference.id).toArray(),
    ])

    if (sectorResult.error || !sectorResult.data) {
        return { ok: false, message: `O setor "${conference.sector}" não está cadastrado no painel.` }
    }
    if (repositorResult.error || !repositorResult.data) {
        return { ok: false, message: `O repositor "${conference.staffName}" não está cadastrado no painel.` }
    }

    const { error: conferenceError } = await supabase.from('conferences').upsert({
        id: conference.id,
        sector_id: sectorResult.data.id,
        repositor_id: repositorResult.data.id,
        created_by: authData.user.id,
        started_at: conference.startedAt,
        finalized_at: conference.finalizedAt ?? new Date().toISOString(),
        status: 'submitted',
    }, { onConflict: 'id' })
    if (conferenceError) return { ok: false, message: 'Não foi possível enviar os dados da conferência. Ela continua salva neste aparelho.' }

    const remoteItems = items.map((item: InventoryItem) => ({
        id: item.id,
        conference_id: item.conferenceId,
        barcode: item.barcode,
        name: item.name,
        quantity: item.quantity,
        due_date: item.dueDate,
        unregistered: item.unregistered,
        created_at: item.createdAt,
    }))
    if (remoteItems.length > 0) {
        const { error: itemsError } = await supabase.from('items').upsert(remoteItems, { onConflict: 'id' })
        if (itemsError) return { ok: false, message: 'A conferência foi iniciada no envio, mas os itens ainda não foram confirmados. Tente enviar novamente.' }
    }

    const receivedAt = new Date().toISOString()
    const { error: statusError } = await supabase.from('conferences').update({
        status: 'received',
        received_at: receivedAt,
    }).eq('id', conference.id)
    if (statusError) return { ok: false, message: 'Os itens chegaram, mas falta confirmar o recebimento. Tente enviar novamente.' }

    const syncedConference: LocalConference = { ...conference, status: 'received', receivedAt }
    await db.conferences.put(syncedConference)
    return { ok: true, conference: syncedConference }
}

export async function loadRemoteProducts(): Promise<LocalProduct[]> {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('products')
        .select('barcode, name, updated_at')
        .order('barcode')
    if (error) throw error
    return (data ?? []).map((product) => ({
        barcode: product.barcode,
        name: product.name,
        updatedAt: product.updated_at,
    }))
}

export async function loadRemoteWorkLists(): Promise<{ sectors: string[]; repositors: string[] }> {
    if (!supabase) return { sectors: [], repositors: [] }
    const [sectorsResult, repositorsResult] = await Promise.all([
        supabase.from('sectors').select('name').eq('active', true).order('name'),
        supabase.from('repositors').select('name').eq('active', true).order('name'),
    ])
    if (sectorsResult.error) throw sectorsResult.error
    if (repositorsResult.error) throw repositorsResult.error
    return {
        sectors: (sectorsResult.data ?? []).map((sector) => sector.name),
        repositors: (repositorsResult.data ?? []).map((repositor) => repositor.name),
    }
}

export async function syncPendingLocalConferences(): Promise<{ synced: LocalConference[]; message: string }> {
    const pending = await db.conferences.where('status').equals('pending').toArray()
    const synced: LocalConference[] = []
    for (const conference of pending) {
        const result = await syncConferenceToCloud(conference.id)
        if (!result.ok) return { synced, message: result.message }
        synced.push(result.conference)
    }
    return { synced, message: synced.length ? `${synced.length} conferência(s) enviada(s) ao painel.` : '' }
}
