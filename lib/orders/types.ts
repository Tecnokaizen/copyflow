export type OrderNamedRef = {
  name: string;
};

export type OrderCodedRef = {
  id: string;
  code: string;
  name: string;
};

export type OrderClient = {
  id: string;
  customer_type_id: string | null;
  name: string;
  contact_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export type OrderStatus = {
  id: string;
  code: string;
  name: string;
  is_initial?: boolean;
  is_ready?: boolean;
  is_closed?: boolean;
  is_cancelled?: boolean;
};

export type Order = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  priority: string;
  due_at: string | null;
  received_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  customer_notification_status: string;
  notes: string | null;
  client_id: string | null;
  status_id: string | null;

  client: OrderClient | null;
  service: OrderNamedRef | null;
  service_id: string | null;
  entry_channel_id: string | null;
  assigned_team_member_id: string | null;
  order_context_id: string | null;
  entry_channel: OrderNamedRef | null;
  assigned_team_member: OrderNamedRef | null;
  status: {
    name: string;
    code: string;
    is_initial?: boolean;
    is_ready?: boolean;
    is_closed?: boolean;
    is_cancelled?: boolean;
  } | null;
  order_context: OrderNamedRef | null;

  file_status_id: string | null;
  quote_status_id: string | null;
  payment_status_id: string | null;
  delivery_method_id: string | null;
  file_status: OrderCodedRef | null;
  quote_status: OrderCodedRef | null;
  payment_status: OrderCodedRef | null;
  delivery_method: OrderCodedRef | null;
};

export type OrderResponse = {
  tenant: string;
  order: Order;
};

export type ActivityItem = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  team_member_id: string | null;
  previous_values: {
    status_id?: string | null;
    status_code?: string | null;
    status_name?: string | null;
    customer_notification_status?: string | null;
    customer_notified_at?: string | null;
    customer_notified_by?: string | null;
    option_id?: string | null;
    option_code?: string | null;
    option_name?: string | null;
    value?: string | null;
    value_id?: string | null;
    value_code?: string | null;
    value_name?: string | null;
    client_id?: string | null;
    client_name?: string | null;
  } | null;
  new_values: {
    status_id?: string | null;
    status_code?: string | null;
    status_name?: string | null;
    customer_notification_status?: string | null;
    customer_notified_at?: string | null;
    customer_notified_by?: string | null;
    option_id?: string | null;
    option_code?: string | null;
    option_name?: string | null;
    value?: string | null;
    value_id?: string | null;
    value_code?: string | null;
    value_name?: string | null;
    client_id?: string | null;
    client_name?: string | null;
  } | null;
  metadata: {
    reference?: string;
    field?: string;
    [key: string]: unknown;
  };
  created_at: string;
  actor: {
    id: string;
    name: string;
  } | null;
};

export type ActivityResponse = {
  tenant: string;
  order: {
    id: string;
    reference: string;
  };
  count: number;
  activity: ActivityItem[];
};

export type ManagementOption = {
  id: string;
  code: string;
  name: string;
};

export type ManagementOptionsResponse = {
  tenant: string;
  file_statuses: ManagementOption[];
  quote_statuses: ManagementOption[];
  payment_statuses: ManagementOption[];
  delivery_methods: ManagementOption[];
};

export type ManagementField =
  | "file_status_id"
  | "quote_status_id"
  | "payment_status_id"
  | "delivery_method_id";

export type DetailField =
  | "priority"
  | "service_id"
  | "entry_channel_id"
  | "assigned_team_member_id"
  | "order_context_id"
  | "due_at";

export type ContentField = "title" | "description" | "notes";

export type ClientUiMode = "edit" | "create" | "assign" | "change";

export type OrderOption = {
  id: string;
  name: string;
};

export type CodedOrderOption = {
  id: string;
  code: string;
  name: string;
};

export type OrderOptionsResponse = {
  tenant: string;
  services: OrderOption[];
  entry_channels: CodedOrderOption[];
  order_contexts: CodedOrderOption[];
  team_members: OrderOption[];
};

/** Editable snapshot used while the workspace is in edit mode. */
export type OrderDraft = {
  title: string;
  description: string;
  notes: string;
  status_id: string;
  priority: string;
  service_id: string | null;
  entry_channel_id: string | null;
  assigned_team_member_id: string | null;
  order_context_id: string | null;
  due_at: string | null;
  file_status_id: string | null;
  quote_status_id: string | null;
  payment_status_id: string | null;
  delivery_method_id: string | null;
  customer_notification_status: string;
};
