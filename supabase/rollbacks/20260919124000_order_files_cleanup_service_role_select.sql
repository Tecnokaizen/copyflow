begin;

REVOKE SELECT ON TABLE public.order_files FROM service_role;

commit;
