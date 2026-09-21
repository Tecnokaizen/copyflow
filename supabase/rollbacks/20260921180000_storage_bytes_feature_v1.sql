begin;

delete from public.features
where code = 'storage_bytes'
  and id = '31000000-0000-4000-8000-000000000005';

commit;
