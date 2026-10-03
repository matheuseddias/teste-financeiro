import type { CostCategory } from './planning';
export type KaminoKind = 'pagamentos' | 'notas';
export type KaminoSlot = 'principal' | 'home';
export interface KaminoSource {
 id: string; tenant_id: string; slot: KaminoSlot; kind: KaminoKind; enabled: boolean;
 validated_at: string | null; last_attempt_at: string | null; last_success_at: string | null;
 last_full_sync_at: string | null; last_error: string | null; next_attempt_at: string | null;
 cursor: Record<string, unknown>; version: number; deleted_at: string | null;
}
export interface KaminoDocumentData {
 source_id: string; description: string; due_date: string | null; issue_date: string | null;
 amount_cents: number; paid_cents: number | null; status: string; unit_id: string | null; unit_name?: string | null;
 supplier: string | null; supplier_document: string | null; invoice_number: string | null;
 invoice_key: string | null; invoice_source_id: string | null; category_key: string | null;
}
export interface KaminoDocument extends KaminoDocumentData {
 id: string; tenant_id: string; slot: KaminoSlot; kind: KaminoKind; fingerprint: string;
 commitment_id: string | null; reviewed_fingerprint: string | null; company_id: string | null;
 category: CostCategory | null; version: number; deleted_at: string | null; updated_at: string;
}
