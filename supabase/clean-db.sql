-- Safe cleanup - only core existing tables
TRUNCATE TABLE public.orders CASCADE;
TRUNCATE TABLE public.menu_items CASCADE;
TRUNCATE TABLE public.vendors CASCADE;
TRUNCATE TABLE public.riders CASCADE;
TRUNCATE TABLE public.reviews CASCADE;
TRUNCATE TABLE public.notifications CASCADE;
DELETE FROM public.users;
SELECT 'Database cleaned ✓' as status;
