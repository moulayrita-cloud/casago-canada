// database.js (ESM)

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';   // ✅ THIS WAS MISSING

//import { normalizePhone } from './sms.js';

// Load .env correctly
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

// Read environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate
if (!supabaseUrl || !serviceKey) {
  console.error("[ENV] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
console.log('[DATABASE.JS LOADED]');

// Create Supabase client
export const supabase = createClient(supabaseUrl, serviceKey);
//////////// consolidate /////////////
// database.js
export async function updateRide({ id, job_id }, patch) {
  try {
    let q = supabase.from('rides').update(patch);

    if (id != null && Number.isFinite(Number(id))) {
      q = q.eq('id', Number(id));
    } else if (job_id != null) {
      q = q.eq('job_id', String(job_id));
    } else {
      throw new Error('updateRide requires id or job_id');
    }

    const { data, error } = await q.select().maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[updateRide] failed', {
      id,
      job_id,
      patch,
      err: e?.message || e
    });
    throw e;
  }
}
////////////////////
export async function releaseDriverForRide({ rideId, driverId, driverPhone }) {
  const rid = Number(rideId);
  const did = Number(driverId);

  const phoneE164 = String(driverPhone || '')
    .trim()
    .replace(/^whatsapp:/i, '')
    .trim();

  if (!Number.isFinite(did) && !phoneE164) {
    console.error('[RELEASE] missing driver id/phone', { driverId, driverPhone });
    return { ok: false, reason: 'missing_driver_identifier' };
  }

  let q = supabase.from('drivers_table').update({
    is_available: true,
    on_ride: false,
    current_ride_id: null,
  });

  if (Number.isFinite(did)) {
    q = q.eq('id', did);
  } else {
    q = q.eq('phone', phoneE164);
  }

  const { data, error } = await q.select('id, phone, current_ride_id');

  console.log('[RELEASE RESULT]', {
    rideId: Number.isFinite(rid) ? rid : null,
    driverId: Number.isFinite(did) ? did : null,
    driverPhone: phoneE164 || null,
    updated: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null,
  });

  if (error) return { ok: false, reason: 'db_error', error: error.message };
  if (!data || data.length === 0) return { ok: false, reason: 'no_rows_updated' };

  return { ok: true, released: data };
}
////////////////////////////////////////////////////////
export async function claimDriverForRide({ driverId, rideId }) {
  const rideIdNum = Number(rideId);
  const driverIdNum = Number(driverId);

  if (!Number.isFinite(driverIdNum) || !Number.isFinite(rideIdNum)) {
    return { ok: false, reason: 'bad_ids', driverId, rideId };
  }

  const { data, error } = await supabase
    .from('drivers_table')
    .update({
      is_available: false,
      on_ride: true,
      current_ride_id: rideIdNum,
      location_updated_at: new Date().toISOString(),
    })
    .eq('id', driverIdNum)
    .eq('is_available', true)
    .is('current_ride_id', null)
    .select('id, phone, current_ride_id')
    .maybeSingle();

  console.log('[CLAIM RESULT]', {
    driverId: driverIdNum,
    rideId: rideIdNum,
    ok: !!data,
    error: error?.message ?? null,
    current_ride_id: data?.current_ride_id ?? null,
  });

  if (error) return { ok: false, reason: 'db_error', error: error.message };
  if (!data) return { ok: false, reason: 'not_free' };

  return { ok: true, driver: data };
}
////////////////////////////////////////////////////////
export async function recoverStuckDriversOnBoot() {
    // 1) Find terminal rides (adjust statuses to match your app)
    const TERMINAL = ['Completed', 'Cancelled', 'NoDrivers', 'Expired', 'Failed'];

    const { data: rides, error: rideErr } = await supabase
        .from('rides')
        .select('id')
        .in('status', TERMINAL)
        .limit(5000);

    if (rideErr) {
        console.log('[BOOT RECOVER] rides query failed', rideErr.message);
        return { ok: false, reason: 'rides_query_failed' };
    }

    const ids = (rides || []).map((r) => r.id).filter(Boolean);
    if (!ids.length) {
        console.log('[BOOT RECOVER] nothing to recover');
        return { ok: true, released: 0 };
    }

    // 2) Release drivers that still point to those terminal rides
    const { error: drvErr, count } = await supabase
        .from('drivers_table')
        .update({
            is_available: true,
            current_ride_id: null,
            on_ride: false,
            last_seen: new Date().toISOString
            
            (),
            location_updated_at: new Date().toISOString(),
        })
        .in('current_ride_id', ids);

    if (drvErr) {
        console.log('[BOOT RECOVER] drivers release failed', drvErr.message);
        return { ok: false, reason: 'drivers_release_failed' };
    }

    console.log('[BOOT RECOVER] released drivers linked to terminal rides', { rides: ids.length });
    return { ok: true, released: count ?? null };
}

// ---------------------------------------------------------
// NEAREST DRIVER
//  Added and updated new on 4-13-2006 //////////////////////////
// ---------------------------------------------------------
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // km

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function dbgetNearestDrivers({ lat, lng, type_vehicle, limit = 5 }) {
  const pickupLat = Number(lat);
  const pickupLng = Number(lng);

  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    console.log('[dbgetNearestDrivers] invalid pickup coordinates', { lat, lng });
    return [];
  }

  // Freshness window = 5 minutes
  const lastSeenSeconds =
  Number(process.env.DRIVER_LAST_SEEN_SECONDS) ||
  (Number(process.env.DRIVER_FRESH_MINUTES) || 0) * 60 ||
  300;
  const cutoffIso = new Date(Date.now() - lastSeenSeconds * 1000).toISOString();

  const MAX_RADIUS_KM = 10;

  console.log('[FRESHNESS CONFIG]', {
  DRIVER_LAST_SEEN_SECONDS: process.env.DRIVER_LAST_SEEN_SECONDS,
  DRIVER_FRESH_MINUTES: process.env.DRIVER_FRESH_MINUTES,
  lastSeenSeconds,
  cutoffIso,
  maxRadiusKm: MAX_RADIUS_KM,
});

  console.log('[dbgetNearestDrivers IN]', {
    lat: pickupLat,
    lng: pickupLng,
    type_vehicle,
    limit,
  });

  let q = supabase
    .from('drivers_table')
    .select('id, phone, is_available, type_vehicle, lat, lng, last_seen, current_ride_id, enforce_insurance, insurance_expires_at')
    .eq('is_available', true)
    .is('current_ride_id', null)
    .gte('last_seen', cutoffIso);
console.log('[dbgetNearestDrivers FILTER TYPE]', { type_vehicle });
  if (type_vehicle != null && String(type_vehicle).trim() !== '') {
    q = q.eq('type_vehicle', String(type_vehicle).trim());
  }

  const { data, error } = await q;

  console.log('[dbgetNearestDrivers RAW OUT]', {
    error: error?.message ?? null,
    count: Array.isArray(data) ? data.length : 0,
    sample: Array.isArray(data) && data.length ? data[0] : null,
  });

  if (error || !Array.isArray(data)) return [];

  const filtered = data
    .map((d) => {
      const driverLat = Number(d.lat);
      const driverLng = Number(d.lng);

      if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng)) {
        return null;
      }

      const distance_km = haversineKm(pickupLat, pickupLng, driverLat, driverLng);

      return {
        ...d,
        distance_km,
      };
    })
    .filter(Boolean)
    .filter((d) => d.distance_km <= MAX_RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);

  console.log('[dbgetNearestDrivers FINAL OUT]', {
    count: filtered.length,
    drivers: filtered.map((d) => ({
      id: d.id,
      phone: d.phone,
      type_vehicle: d.type_vehicle,
      distance_km: Number(d.distance_km.toFixed(3)),
      last_seen: d.last_seen,
    })),
  });

  return filtered;
}
//////////////////updated new on 4-13-2006 ///////////////
// ---------------------------------------------------------
export async function dbListAvailableDrivers(limit = 10) {
  const { data, error } = await supabase
    .from('drivers_table')
    .select('full_name, phone, lat, lng, is_available')
    .eq('is_available', true)
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------
// PING
// ---------------------------------------------------------
export async function dbPing() {
  const { error } = await supabase
    .from('drivers_table')
    .select('phone')
    .limit(1);

  return !error;
}

// ---------------------------------------------------------
// HEARTBEAT UPDATE (ONLY ONE VERSION!)
// ---------------------------------------------------------

export async function dbUpdateHeartbeat({ phone, lat, lng }) {
  const clean = normalizePhone(phone);
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!clean || !Number.isFinite(latN) || !Number.isFinite(lngN)) return { ok: false, reason: 'bad_input' };

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('drivers_table')
    .upsert(
      {
        phone: clean,
        lat: latN,
        lng: lngN,
        last_seen: now,
        location_updated_at: now,
      },
      { onConflict: 'phone' }
    )
    .select('driver_id, phone, lat, lng, last_seen, current_ride_id')
    .maybeSingle();

  if (error) {
    console.error('[heartbeat] DB upsert FAILED', error);
    return { ok: false, reason: 'db_error', error: error.message };
  }

  return { ok: true, driver: data ?? null };
}

