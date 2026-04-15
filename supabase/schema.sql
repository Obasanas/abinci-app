-- ============================================================
-- abinci.food — Complete Supabase Schema
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL)
-- Safe to re-run (IF NOT EXISTS / OR REPLACE everywhere)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

-- ── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT UNIQUE NOT NULL,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer','vendor','rider','admin')),
  avatar_url  TEXT,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add is_suspended column if it doesn't exist (for existing databases)
ALTER TABLE IF EXISTS public.users
ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

-- ── otp_codes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── vendors ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  business_name    TEXT NOT NULL,
  bio              TEXT,
  address          TEXT,
  area             TEXT,
  city             TEXT,
  state            TEXT,
  logo_url         TEXT,
  emoji            TEXT DEFAULT '🍲',
  food_types       TEXT[] DEFAULT '{}',
  delivery_option  TEXT CHECK (delivery_option IN ('delivery','pickup','both')),
  delivery_fee     NUMERIC DEFAULT 0,
  delivery_radius  TEXT,
  open_time        TEXT DEFAULT '08:00',
  close_time       TEXT DEFAULT '20:00',
  operating_days   TEXT[] DEFAULT '{}',
  min_order        NUMERIC,
  is_available     BOOLEAN NOT NULL DEFAULT TRUE,
  is_approved      BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  rating           NUMERIC(3,2),
  review_count     INTEGER NOT NULL DEFAULT 0,
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── menu_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  price            NUMERIC NOT NULL CHECK (price >= 0),
  emoji            TEXT DEFAULT '🍽️',
  image_url        TEXT,
  plates_available INTEGER,
  is_available     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── riders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.riders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vehicle_type            TEXT DEFAULT 'motorcycle'
                            CHECK (vehicle_type IN ('motorcycle','bicycle','tricycle','car','foot')),
  vehicle_plate           TEXT,
  service_area            TEXT,
  bank_name               TEXT,
  account_number          TEXT,
  account_name            TEXT,
  nin                     TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  is_approved             BOOLEAN NOT NULL DEFAULT FALSE,
  is_online               BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason        TEXT,
  trips_count             INTEGER NOT NULL DEFAULT 0,
  rating                  NUMERIC(3,2),
  current_lat             DOUBLE PRECISION,
  current_lng             DOUBLE PRECISION,
  location_updated_at     TIMESTAMPTZ,
  kyc_submitted_at        TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── orders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID REFERENCES public.vendors(id),
  customer_id      UUID REFERENCES public.users(id),
  rider_id         UUID REFERENCES public.riders(id),
  customer_name    TEXT,
  customer_phone   TEXT,
  items            JSONB NOT NULL DEFAULT '[]',
  total_amount     NUMERIC NOT NULL CHECK (total_amount >= 0),
  delivery_type    TEXT DEFAULT 'delivery' CHECK (delivery_type IN ('delivery','pickup')),
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','rejected','ready','out_for_delivery','delivered','cancelled')),
  payment_method   TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash','card','mobile_money')),
  payment_status   TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── reviews ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES public.users(id),
  customer_name    TEXT NOT NULL DEFAULT 'Anonymous',
  rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── push_tokens ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_otp_phone        ON public.otp_codes(phone, expires_at);
CREATE INDEX IF NOT EXISTS idx_vendors_user     ON public.vendors(user_id);
CREATE INDEX IF NOT EXISTS idx_vendors_approved ON public.vendors(is_approved, is_available);
CREATE INDEX IF NOT EXISTS idx_vendors_geo      ON public.vendors(latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_vendor      ON public.menu_items(vendor_id, is_available);
CREATE INDEX IF NOT EXISTS idx_riders_user      ON public.riders(user_id);
CREATE INDEX IF NOT EXISTS idx_riders_online    ON public.riders(is_online, is_approved);
CREATE INDEX IF NOT EXISTS idx_riders_geo       ON public.riders(current_lat, current_lng) WHERE current_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_vendor    ON public.orders(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer  ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_rider     ON public.orders(rider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON public.orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_vendor   ON public.reviews(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user       ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_user        ON public.push_tokens(user_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','vendors','menu_items','orders','riders']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON public.%I;
       CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t, t);
  END LOOP;
END; $$;

-- ============================================================
-- AUTO-UPDATE VENDOR RATING AFTER REVIEW
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_vendor_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.vendors SET
    rating       = (SELECT ROUND(AVG(rating)::NUMERIC,2) FROM public.reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id)),
    review_count = (SELECT COUNT(*) FROM public.reviews WHERE vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id))
  WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_rating ON public.reviews;
CREATE TRIGGER trg_update_rating
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.update_vendor_rating();

-- ============================================================
-- INCREMENT RIDER TRIPS COUNTER ON DELIVERY
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_rider_trips()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' AND NEW.rider_id IS NOT NULL THEN
    UPDATE public.riders SET trips_count = trips_count + 1 WHERE id = NEW.rider_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rider_trips ON public.orders;
CREATE TRIGGER trg_rider_trips
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.increment_rider_trips();

-- ============================================================
-- CLEAN UP EXPIRED OTPs
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS INTEGER AS $$
DECLARE deleted INTEGER;
BEGIN
  DELETE FROM public.otp_codes WHERE expires_at < NOW() OR used = TRUE;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users','otp_codes','vendors','menu_items','orders',
    'reviews','notifications','push_tokens','riders'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END; $$;

-- Drop all existing policies
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END; $$;

-- service_role bypasses everything (used by Node API)
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users','otp_codes','vendors','menu_items','orders',
    'reviews','notifications','push_tokens','riders'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "service_role_all" ON public.%I FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);', tbl);
  END LOOP;
END; $$;

-- users
CREATE POLICY "users_read_own"   ON public.users FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users_anon_insert"ON public.users FOR INSERT TO anon WITH CHECK (TRUE);

-- otp_codes (API only via service_role — no direct client access)

-- vendors
CREATE POLICY "vendors_public_read"  ON public.vendors FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "vendors_owner_update" ON public.vendors FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "vendors_anon_insert"  ON public.vendors FOR INSERT TO anon WITH CHECK (TRUE);

-- menu_items
CREATE POLICY "menu_public_read"   ON public.menu_items FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "menu_vendor_manage" ON public.menu_items FOR ALL TO authenticated
  USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()))
  WITH CHECK (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));
CREATE POLICY "menu_anon_insert"   ON public.menu_items FOR INSERT TO anon WITH CHECK (TRUE);

-- riders
CREATE POLICY "riders_public_read" ON public.riders FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "riders_own_manage"  ON public.riders FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "riders_anon_insert" ON public.riders FOR INSERT TO anon WITH CHECK (TRUE);

-- orders
CREATE POLICY "orders_customer_read" ON public.orders FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY "orders_vendor_read"   ON public.orders FOR SELECT TO authenticated
  USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));
CREATE POLICY "orders_rider_read"    ON public.orders FOR SELECT TO authenticated
  USING (rider_id IN (SELECT id FROM public.riders WHERE user_id = auth.uid()));
CREATE POLICY "orders_anyone_insert" ON public.orders FOR INSERT TO anon, authenticated WITH CHECK (TRUE);
CREATE POLICY "orders_vendor_update" ON public.orders FOR UPDATE TO authenticated
  USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));
CREATE POLICY "orders_rider_update"  ON public.orders FOR UPDATE TO authenticated
  USING (rider_id IN (SELECT id FROM public.riders WHERE user_id = auth.uid()));

-- reviews
CREATE POLICY "reviews_public_read"       ON public.reviews FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "reviews_authenticated_ins" ON public.reviews FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "reviews_anon_insert"       ON public.reviews FOR INSERT TO anon WITH CHECK (TRUE);

-- notifications
CREATE POLICY "notif_read_own"   ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_insert_own" ON public.notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_update_own" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- push_tokens
CREATE POLICY "push_manage_own" ON public.push_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_anon_insert"ON public.push_tokens FOR INSERT TO anon WITH CHECK (TRUE);

-- ============================================================
-- REALTIME (enable on key tables)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.riders;

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('abinci-media', 'abinci-media', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "media_public_read" ON storage.objects;
DROP POLICY IF EXISTS "media_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "media_owner_manage" ON storage.objects;

CREATE POLICY "media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'abinci-media');
CREATE POLICY "media_auth_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'abinci-media');
CREATE POLICY "media_owner_manage" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'abinci-media' AND auth.uid()::TEXT = (storage.foldername(name))[1]);

-- ============================================================
-- SEED: Create default admin user
-- Update the phone number to yours before running
-- ============================================================
-- INSERT INTO public.users (phone, full_name, role)
-- VALUES ('+2348012345678', 'Admin User', 'admin')
-- ON CONFLICT (phone) DO NOTHING;

-- Add pickup_deadline for 2-stage driver accept flow
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup_deadline TIMESTAMPTZ;

-- Add delivery address
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
