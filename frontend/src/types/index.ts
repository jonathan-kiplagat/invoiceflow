// Money and quantities travel as strings to keep exact decimal precision end to end.
export type Dec = string;

export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";
export type QuotationStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "converted";
export type PricingMode = "exclusive" | "inclusive";
export type TemplateKey = "modern" | "corporate" | "elegant" | "classic";
export type PaymentMethod = "cash" | "bank_transfer" | "mpesa" | "card" | "cheque" | "other";
export type DocKind = "invoice" | "quotation";

export interface User {
  id: number;
  email: string;
  full_name: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface TaxRate {
  id: number;
  name: string;
  rate: Dec;
  is_active: boolean;
}

export interface BusinessProfile {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  registration_number: string | null;
  kra_pin: string | null;
  vat_registered: boolean;
  vat_number: string | null;
}

export interface BusinessSettings {
  default_currency: string;
  default_tax_rate_id: number | null;
  pricing_mode: PricingMode;
  payment_terms_days: number;
  quote_validity_days: number;
  invoice_number_format: string;
  next_invoice_seq: number;
  quote_number_format: string;
  next_quote_seq: number;
  default_template: TemplateKey;
  date_format: "DD MMM YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
  show_signature: boolean;
  accent_color: string;
  default_notes: string | null;
  default_terms: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch: string | null;
  bank_swift: string | null;
  mpesa_type: "none" | "paybill" | "till" | "phone";
  mpesa_paybill: string | null;
  mpesa_account: string | null;
  mpesa_till: string | null;
  mpesa_phone: string | null;
  mpesa_name: string | null;
  other_payment_instructions: string | null;
}

export interface Business {
  profile: BusinessProfile;
  settings: BusinessSettings;
  tax_rates: TaxRate[];
  logo_data_url: string | null;
  payment_instructions_preview: string;
  invoice_number_preview: string;
  quote_number_preview: string;
}

export interface Customer {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  tax_id: string | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
}

export interface CustomerWithStats extends Customer {
  invoice_count: number;
  total_invoiced: Dec;
  total_paid: Dec;
  outstanding: Dec;
  currency: string;
}

export interface CustomerInput {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  billing_address?: string | null;
  tax_id?: string | null;
  notes?: string | null;
  is_archived?: boolean;
}

export interface ItemInput {
  description: string;
  quantity: Dec;
  unit_price: Dec;
  discount_type: "percent" | "amount";
  discount_value: Dec;
  tax_rate_id: number | null;
  tax_name: string | null;
  tax_rate: Dec;
}

export interface Item extends ItemInput {
  id: number;
  position: number;
  line_subtotal: Dec;
  line_discount: Dec;
  line_tax: Dec;
  line_total: Dec;
}

export interface Payment {
  id: number;
  invoice_id: number;
  payment_date: string;
  amount: Dec;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface PaymentListItem extends Payment {
  invoice_number: string;
  customer_name: string | null;
  currency: string;
}

export interface Snapshot {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  billing_address?: string | null;
  tax_id?: string | null;
  address?: string | null;
  website?: string | null;
  kra_pin?: string | null;
  vat_registered?: boolean;
  vat_number?: string | null;
  registration_number?: string | null;
}

export interface DocumentBase {
  id: number;
  number: string;
  client_uuid: string;
  version: number;
  customer_id: number | null;
  customer_snapshot: Snapshot | null;
  business_snapshot: Snapshot | null;
  issue_date: string;
  currency: string;
  pricing_mode: PricingMode;
  template: TemplateKey;
  notes: string | null;
  terms: string | null;
  payment_instructions: string | null;
  shipping: Dec;
  subtotal: Dec;
  discount_total: Dec;
  tax_total: Dec;
  total: Dec;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  items: Item[];
}

export interface Invoice extends DocumentBase {
  status: InvoiceStatus;
  due_date: string;
  amount_paid: Dec;
  balance_due: Dec;
  cancelled_at: string | null;
  share_token: string | null;
  quotation_id: number | null;
  payments: Payment[];
}

export interface Quotation extends DocumentBase {
  status: QuotationStatus;
  valid_until: string;
  converted_invoice_id: number | null;
  converted_at: string | null;
}

export interface InvoiceSummary {
  id: number;
  number: string;
  client_uuid: string;
  version: number;
  status: InvoiceStatus;
  customer_id: number | null;
  customer_name: string | null;
  issue_date: string;
  due_date: string;
  currency: string;
  total: Dec;
  amount_paid: Dec;
  balance_due: Dec;
  updated_at: string;
}

export interface QuotationSummary {
  id: number;
  number: string;
  status: QuotationStatus;
  customer_name: string | null;
  issue_date: string;
  valid_until: string;
  currency: string;
  total: Dec;
  converted_invoice_id: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** What the editor sends to the API (and stores offline). */
export interface DocumentInput {
  client_uuid: string;
  client_revision?: string;
  customer_id: number | null;
  new_customer?: CustomerInput | null;
  issue_date: string;
  due_date?: string;
  valid_until?: string;
  status?: "draft" | "sent";
  currency: string;
  pricing_mode: PricingMode;
  template: TemplateKey;
  notes: string | null;
  terms: string | null;
  payment_instructions: string | null;
  shipping: Dec;
  items: ItemInput[];
  version?: number;
  force_overwrite?: boolean;
}

export interface ShareInfo {
  share_url: string | null;
  pdf_url: string | null;
  whatsapp_phone: string | null;
  whatsapp_message: string;
  whatsapp_url: string;
  email_to: string | null;
  email_subject: string;
  email_body: string;
  mailto_url: string;
  email_integration_enabled: boolean;
}

export interface Meta {
  app_name: string;
  timezone: string;
  email_integration_enabled: boolean;
  currencies: { code: string; symbol: string; name: string }[];
  payment_methods: { key: PaymentMethod; label: string }[];
}
