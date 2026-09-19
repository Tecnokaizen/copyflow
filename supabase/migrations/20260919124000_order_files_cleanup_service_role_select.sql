-- Files V1 · allow server-side maintenance to list order_files.
-- Maintenance still mutates metadata only through controlled RPCs.

begin;

GRANT SELECT ON TABLE public.order_files TO service_role;

commit;
