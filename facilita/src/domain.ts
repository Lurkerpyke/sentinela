export type DateMode = 'day' | 'month'

export interface InventoryItem {
    id: string
    conferenceId: string
    barcode: string
    name: string
    quantity: number
    dueDate: string
    unregistered: boolean
    createdAt: string
}

export interface NewInventoryItem extends Omit<InventoryItem, 'id' | 'createdAt'> {
    id?: string
    createdAt?: string
}

function hasValidCheckDigit(value: string): boolean {
    const digits = value.slice(0, -1).split('').map(Number)
    const weightedSum = digits.reduce((sum, digit, index) => {
        const distanceFromRight = digits.length - index - 1
        return sum + digit * (distanceFromRight % 2 === 0 ? 3 : 1)
    }, 0)

    return (10 - (weightedSum % 10)) % 10 === Number(value.at(-1))
}

export function normalizeBarcode(value: string): string | null {
    const digits = value.replace(/\s/g, '')
    if (!/^\d+$/.test(digits)) return null

    const normalized = digits.length === 12 ? `0${digits}` : digits
    if (![8, 13].includes(normalized.length) || !hasValidCheckDigit(normalized)) return null
    return normalized
}

export function parseDueDate(value: string, mode: DateMode): string | null {
    if (!/^\d+$/.test(value) || value.length !== 6) return null

    let day: number
    let month: number
    let year: number

    if (mode === 'day') {
        day = Number(value.slice(0, 2))
        month = Number(value.slice(2, 4))
        year = 2000 + Number(value.slice(4, 6))
    } else {
        month = Number(value.slice(0, 2))
        year = Number(value.slice(2, 6))
        if (year < 2000) return null
        day = new Date(Date.UTC(year, month, 0)).getUTCDate()
    }

    if (year < 2000 || month < 1 || month > 12 || day < 1) return null
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isPastDue(dueDate: string, today = new Date()): boolean {
    const todayIso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-')
    return dueDate < todayIso
}

export function isMoreThanYearsAhead(dueDate: string, years: number, today = new Date()): boolean {
    const [year, month, day] = dueDate.split('-').map(Number)
    const futureLimit = new Date(today.getFullYear() + years, today.getMonth(), today.getDate())
    const due = new Date(year, month - 1, day)
    return due > futureLimit
}

export function mergeDuplicateItems(
    items: InventoryItem[],
    incoming: NewInventoryItem,
): { savedItem: InventoryItem; merged: boolean } {
    const duplicate = items.find((item) =>
        item.conferenceId === incoming.conferenceId &&
        item.barcode === incoming.barcode &&
        item.dueDate === incoming.dueDate,
    )

    if (duplicate) {
        return {
            savedItem: { ...duplicate, quantity: duplicate.quantity + incoming.quantity },
            merged: true,
        }
    }

    return {
        savedItem: {
            ...incoming,
            id: incoming.id ?? crypto.randomUUID(),
            createdAt: incoming.createdAt ?? new Date().toISOString(),
        },
        merged: false,
    }
}
