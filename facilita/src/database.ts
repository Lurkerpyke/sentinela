import Dexie, { type EntityTable } from 'dexie'
import type { InventoryItem } from './domain'

export interface LocalProduct {
    barcode: string
    name: string
    updatedAt: string
}

export interface Conference {
    id: string
    staffName: string
    sector: string
    startedAt: string
    status: 'inProgress' | 'pending' | 'received'
    finalizedAt?: string
    spreadsheetExportedAt?: string
    receivedAt?: string
}

const sampleProducts: LocalProduct[] = [
    { barcode: '7891000458921', name: 'Biscoito Fandangos bacon 65 g', updatedAt: '2026-09-28T12:00:00.000Z' },
    { barcode: '7891037142213', name: 'Detergente neutro 500 ml', updatedAt: '2026-09-28T12:00:00.000Z' },
    { barcode: '7896019600118', name: 'Desodorante colônia floral 90 ml', updatedAt: '2026-09-28T12:00:00.000Z' },
    { barcode: '7891000100103', name: 'Iogurte natural 170 g', updatedAt: '2026-09-28T12:00:00.000Z' },
]

class FacilitaDatabase extends Dexie {
    conferences!: EntityTable<Conference, 'id'>
    items!: EntityTable<InventoryItem, 'id'>
    products!: EntityTable<LocalProduct, 'barcode'>

    constructor() {
        super('facilita-local')
        this.version(1).stores({
            conferences: 'id, status, startedAt',
            items: 'id, conferenceId, barcode, dueDate, [conferenceId+barcode+dueDate]',
            products: 'barcode, name, updatedAt',
        })
        this.version(2).stores({
            conferences: 'id, status, startedAt',
            items: 'id, conferenceId, barcode, dueDate, [conferenceId+barcode+dueDate]',
            products: 'barcode, name, updatedAt',
        }).upgrade(async (transaction) => {
            const productTable = transaction.table('products')
            await productTable.bulkDelete(['7896019600112', '7891000100108'])
            await productTable.bulkPut(sampleProducts)
        })
    }
}

export const db = new FacilitaDatabase()

export async function initializeDatabase(): Promise<void> {
    await db.open()
    if (await db.products.count() === 0) {
        await db.products.bulkPut(sampleProducts)
    }
}
