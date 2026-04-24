// server.js (ESM)
//console.log('### LOCAL SERVER BOOT ###', new Date().toISOString());
console.log('[BOOT MARKER 2026-03-10 TEST A]');
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import axios from 'axios';
import Stripe from 'stripe';
import { updateRide } from './database.js';
import { jobs, upsertJob, cleanupRideRam, TERMINAL_STATUSES } from './jobs.js';

import {
  supabase,
  dbUpdateHeartbeat,
  dbgetNearestDrivers,
  recoverStuckDriversOnBoot
} from './database.js';

import {
  sendSms,
  handleSmsWebhook,
  normalizePhone,
  formatRideOfferSms,
  sendOfferSMS,
  isE164,
} from './sms.js';
// example: wherever claimDriverForRide is coming from
import { releaseDriverForRide, claimDriverForRide } from './database.js';
// put this AFTER imports (and after dotenv.config() if you ever re-enable it)
//require('dotenv').config();
//const express = require('express');
//const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
///////////////  update for Website form //////////////
// CORS setup to allow website forms
app.use(cors());
////////////////////////////////////////////////////////////
console.log('[BOOT] SUPABASE_URL =', process.env.SUPABASE_URL);

function requireAdmin(req, res, next) {
  const adminKey = String(req.headers['x-admin-key'] || '').trim();
  const expectedKey = String(process.env.ADMIN_APPROVAL_KEY || '').trim();

  if (!expectedKey) {
    return res.status(500).json({ ok: false, error: 'ADMIN_KEY_NOT_CONFIGURED' });
  }

  if (!adminKey || adminKey !== expectedKey) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  }

  next();
}
/////////////// routes added///////////////////////////
///////////////////////////////////////////////////////////
// PUBLIC REGISTRATION ROUTES (website -> Azure -> Supabase)
///////////////////////////////////////////////////////////

// Small helpers
function cleanString(v) {
  return String(v ?? '').trim();
}

function cleanUpper(v) {
  return cleanString(v).toUpperCase();
}

function cleanLower(v) {
  return cleanString(v).toLowerCase();
}

function normalizeSimplePhone(raw) {
  let s = cleanString(raw);
  if (!s) return '';

  // keep leading + if present, remove other non-digits
  if (s.startsWith('+')) {
    s = '+' + s.slice(1).replace(/\D/g, '');
  } else {
    s = s.replace(/\D/g, '');
  }

  // assume Canada/US if 10 digits
  if (/^\d{10}$/.test(s)) {
    s = '+1' + s;
  }

  return s;
}

function isLikelyE164(phone) {
  return /^\+[1-9]\d{7,14}$/.test(String(phone || ''));
}

function isValidDateOnly(v) {
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
}

///////////////////////////////////////////////////////////
// DRIVER REGISTRATION
app.post('/register-driver', async (req, res) => {
  try {
    const full_name = cleanString(req.body?.full_name || req.body?.fullName);
    const phone = normalizeSimplePhone(req.body?.phone);
    const type_vehicle = cleanString(req.body?.type_vehicle || req.body?.typeVehicle);
    const car_plate = cleanUpper(req.body?.car_plate || req.body?.carPlate);
    const payment_method = cleanLower(req.body?.payment_method || req.body?.paymentMethod);
    const insurance_expires_at = cleanString(
      req.body?.insurance_expires_at || req.body?.insuranceExpiresAt
    );

    const email = cleanLower(req.body?.email);
    const city = cleanString(req.body?.city);
    const address = cleanString(req.body?.address);
    const notes = cleanString(req.body?.notes);
    const insurance_no = cleanString(req.body?.insurance_no || req.body?.insuranceNo);
    const cin = cleanString(req.body?.cin);
    const permis_conduire = cleanString(req.body?.permis_conduire || req.body?.permisConduire);

    if (!full_name) {
      return res.status(400).json({ ok: false, error: 'FULL_NAME_REQUIRED' });
    }

    if (!phone || !isLikelyE164(phone)) {
      return res.status(400).json({ ok: false, error: 'VALID_PHONE_REQUIRED' });
    }

    if (!type_vehicle) {
      return res.status(400).json({ ok: false, error: 'TYPE_VEHICLE_REQUIRED' });
    }

    if (!car_plate) {
      return res.status(400).json({ ok: false, error: 'CAR_PLATE_REQUIRED' });
    }

    if (insurance_expires_at && !isValidDateOnly(insurance_expires_at)) {
      return res.status(400).json({ ok: false, error: 'INVALID_INSURANCE_DATE' });
    }

    const { data: existingDriverByPhone, error: existingDriverPhoneErr } = await supabase
      .from('drivers_table')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existingDriverPhoneErr) {
      return res.status(500).json({ ok: false, error: existingDriverPhoneErr.message });
    }

    if (existingDriverByPhone) {
      return res.status(400).json({ ok: false, error: 'DRIVER_ALREADY_EXISTS_BY_PHONE' });
    }

    const { data: existingDriverByPlate, error: existingDriverPlateErr } = await supabase
      .from('drivers_table')
      .select('id')
      .eq('car_plate', car_plate)
      .maybeSingle();

    if (existingDriverPlateErr) {
      return res.status(500).json({ ok: false, error: existingDriverPlateErr.message });
    }

    if (existingDriverByPlate) {
      return res.status(400).json({ ok: false, error: 'DRIVER_ALREADY_EXISTS_BY_PLATE' });
    }

    const { data: existingDriverAppByPhone, error: existingDriverAppErr } = await supabase
      .from('driver_applications')
      .select('id, status')
      .eq('phone', phone)
      .in('status', ['pending', 'approved'])
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDriverAppErr) {
      return res.status(500).json({ ok: false, error: existingDriverAppErr.message });
    }

    if (existingDriverAppByPhone) {
      return res.status(400).json({
        ok: false,
        error: 'DRIVER_APPLICATION_ALREADY_EXISTS',
        status: existingDriverAppByPhone.status,
      });
    }

    const { data: existingDriverAppByPlate, error: existingDriverAppPlateErr } = await supabase
      .from('driver_applications')
      .select('id, status')
      .eq('car_plate', car_plate)
      .in('status', ['pending', 'approved'])
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDriverAppPlateErr) {
      return res.status(500).json({ ok: false, error: existingDriverAppPlateErr.message });
    }

    if (existingDriverAppByPlate) {
      return res.status(400).json({
        ok: false,
        error: 'DRIVER_APPLICATION_PLATE_ALREADY_EXISTS',
        status: existingDriverAppByPlate.status,
      });
    }

    const applicationPayload = {
      full_name,
      phone,
      type_vehicle,
      car_plate,
      payment_method: payment_method || null,
      insurance_expires_at: insurance_expires_at || null,

      email: email || null,
      city: city || null,
      address: address || null,
      notes: notes || null,
      insurance_no: insurance_no || null,
      cin: cin || null,
      permis_conduire: permis_conduire || null,

      status: 'pending',
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('driver_applications')
      .insert([applicationPayload])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(201).json({
      ok: true,
      message: 'Driver application submitted',
      applicationId: data?.id ?? null,
      status: 'pending',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'SERVER_ERROR' });
  }
});
///////////////////////////////////////////////////////////
// RIDER REGISTRATION
///////////////////////////////////////////////////////////
app.post('/register-rider', async (req, res) => {
  try {
    const full_name = cleanString(req.body?.full_name || req.body?.fullName);
    const phone = normalizeSimplePhone(req.body?.phone);
    const email = cleanLower(req.body?.email);
    const address = cleanString(req.body?.address);
    const city = cleanString(req.body?.city);
    const notes = cleanString(req.body?.notes);

    if (!full_name) {
      return res.status(400).json({ ok: false, error: 'FULL_NAME_REQUIRED' });
    }

    if (!phone || !isLikelyE164(phone)) {
      return res.status(400).json({ ok: false, error: 'VALID_PHONE_REQUIRED' });
    }

    // prevent duplicate pending/approved rider applications by phone
    const { data: existingRiderApp, error: existingRiderAppErr } = await supabase
      .from('rider_applications')
      .select('id, status')
      .eq('phone', phone)
      .in('status', ['pending', 'approved'])
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRiderAppErr) {
      return res.status(500).json({ ok: false, error: existingRiderAppErr.message });
    }

    if (existingRiderApp) {
      return res.status(400).json({
        ok: false,
        error: 'RIDER_APPLICATION_ALREADY_EXISTS',
        status: existingRiderApp.status,
      });
    }

    const applicationPayload = {
      full_name,
      phone,
      email: email || null,
      address: address || null,
      city: city || null,
      notes: notes || null,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('rider_applications')
      .insert([applicationPayload])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(201).json({
      ok: true,
      message: 'Rider application submitted',
      applicationId: data?.id ?? null,
      status: 'pending',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'SERVER_ERROR' });
  }
});
// GET pending drivers
app.get('/admin/pending-drivers', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('driver_applications')
    .select('*')
    .eq('status', 'pending')
    .order('id', { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, items: data || [] });
});

// GET pending riders
app.get('/admin/pending-riders', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('rider_applications')
    .select('*')
    .eq('status', 'pending')
    .order('id', { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, items: data || [] });
});
/////////////////////////////////////////////
// APPROVE DRIVER
app.post('/admin/approve-driver', requireAdmin, async (req, res) => {
  try {
    const applicationId = Number(req.body?.applicationId);

    if (!Number.isFinite(applicationId)) {
      return res.status(400).json({ ok: false, error: 'INVALID_APPLICATION_ID' });
    }

    const { data: appRow, error: appErr } = await supabase
      .from('driver_applications')
      .select('*')
      .eq('id', applicationId)
      .maybeSingle();

    if (appErr) {
      return res.status(500).json({ ok: false, error: appErr.message });
    }

    if (!appRow) {
      return res.status(404).json({ ok: false, error: 'APPLICATION_NOT_FOUND' });
    }

    if (appRow.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'APPLICATION_NOT_PENDING' });
    }

    const { data: existingDriverByPhone, error: existingDriverByPhoneErr } = await supabase
      .from('drivers_table')
      .select('id')
      .eq('phone', appRow.phone)
      .maybeSingle();

    if (existingDriverByPhoneErr) {
      return res.status(500).json({ ok: false, error: existingDriverByPhoneErr.message });
    }

    if (existingDriverByPhone) {
      return res.status(400).json({ ok: false, error: 'DRIVER_PHONE_ALREADY_EXISTS' });
    }

    const { data: existingDriverByPlate, error: existingDriverByPlateErr } = await supabase
      .from('drivers_table')
      .select('id')
      .eq('car_plate', appRow.car_plate)
      .maybeSingle();

    if (existingDriverByPlateErr) {
      return res.status(500).json({ ok: false, error: existingDriverByPlateErr.message });
    }

    if (existingDriverByPlate) {
      return res.status(400).json({ ok: false, error: 'DRIVER_PLATE_ALREADY_EXISTS' });
    }

    const driverPayload = {
      phone: appRow.phone,
      full_name: appRow.full_name,
      type_vehicle: appRow.type_vehicle,
      car_plate: appRow.car_plate,

      payment_method: appRow.payment_method || null,
      insurance_expires_at: appRow.insurance_expires_at || null,
      insurance_no: appRow.insurance_no || null,
      cin: appRow.cin || null,
      permis_conduire: appRow.permis_conduire || null,

      is_available: false,
      on_ride: false,
      current_ride_id: null,
      lat: null,
      lng: null,
      last_seen: null,
      location_updated_at: null,
      wallet_balance: 0,
      enforce_insurance: true,
      enforce_cash_wallet_min: false,
    };

    const { error: insertErr } = await supabase
      .from('drivers_table')
      .insert([driverPayload]);

    if (insertErr) {
      return res.status(500).json({ ok: false, error: insertErr.message });
    }

    const now = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('driver_applications')
      .update({
        status: 'approved',
        approved_at: now,
        reviewed_at: now,
      })
      .eq('id', applicationId);

    if (updErr) {
      return res.status(500).json({ ok: false, error: updErr.message });
    }

    return res.json({ ok: true, message: 'Driver approved' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'SERVER_ERROR' });
  }
});
// APPROVE RIDER
app.post('/admin/approve-rider', requireAdmin, async (req, res) => {
  try {
    const applicationId = Number(req.body?.applicationId);

    if (!Number.isFinite(applicationId)) {
      return res.status(400).json({ ok: false, error: 'INVALID_APPLICATION_ID' });
    }

    const { data: appRow, error: appErr } = await supabase
      .from('rider_applications')
      .select('*')
      .eq('id', applicationId)
      .maybeSingle();

    if (appErr) {
      return res.status(500).json({ ok: false, error: appErr.message });
    }

    if (!appRow) {
      return res.status(404).json({ ok: false, error: 'APPLICATION_NOT_FOUND' });
    }

    if (appRow.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'APPLICATION_NOT_PENDING' });
    }

    const { error: updErr } = await supabase
      .from('rider_applications')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', applicationId);

    if (updErr) {
      return res.status(500).json({ ok: false, error: updErr.message });
    }

    return res.json({ ok: true, message: 'Rider approved' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'SERVER_ERROR' });
  }
});

// REJECT RIDER
app.post('/admin/reject-rider', requireAdmin, async (req, res) => {
  try {
    const applicationId = Number(req.body?.applicationId);
    const reason = String(req.body?.reason || '').trim();

    if (!Number.isFinite(applicationId)) {
      return res.status(400).json({ ok: false, error: 'INVALID_APPLICATION_ID' });
    }

    const { error } = await supabase
      .from('rider_applications')
      .update({
        status: 'rejected',
        review_note: reason || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', applicationId);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, message: 'Rider rejected' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'SERVER_ERROR' });
  }
});
/////////////////////////////////////////
// health endpoints for Azure warmup/probes
app.get('/', (req, res) => res.status(200).send('OK'));
app.get('/health', (req, res) => res.status(200).json({ ok: true }));
////////////////////////
(async () => {
    try {
        await recoverStuckDriversOnBoot();
    } catch (e) {
        console.log('[BOOT RECOVER] exception', e?.message || e);
    }
})();

///////////////
function normalizeVehicleType(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();

  // Most specific first
  if (s.includes('pickup2') || s.includes('grand-honda') || s.includes('grand honda')) {
    return 'Grand-Honda';
  }

  if (s.includes('pickup') || s.includes('petit-honda') || s.includes('petit honda') || s === 'honda') {
    return 'Petit-Honda';
  }

  if (s.includes('express')) return 'Express';
  if (s.includes('van') || s.includes('vane') || s.includes('fourgon')) return 'Van';

  return null;
}
///////////////////////////////////////////////////////
function dropJobsForDriverPhone(phoneE164) {
  for (const [jid, j] of jobs.entries()) {
    if (e164(j.currentDriverPhone) === e164(phoneE164)) {
      console.log('[RAM CLEAR DRIVER ONLY]', { phoneE164, jobId: jid });
      j.currentDriverPhone = null;
      j.driverPhone = null;
      j.driver_phone = null;
      upsertJob(jid, j);
    }
  }
}

//////////////////////////////////////////////////////////////////


async function updateRideStatus(job, jobId, patch) {
  const rideId = job?.rideId ?? job?.ride_id ?? job?.dbRideId ?? null;
  return await updateRide({ id: rideId, job_id: jobId }, patch);
}

async function getJobOrRebuildFromDb(jobId) {
  jobId = String(jobId);

  // 1) RAM first
  let job = jobs.get(jobId);
  if (job) {
    return { jobId, job, ride: null };
  }

  // 2) DB fallback only if RAM missing
  const { data: ride, error } = await supabase
    .from('rides')
    .select(`
      id,
      status,
      pickup,
      destination,
      payment_method,
      pickup_lat,
      pickup_lng,
      rider_phone,
      fare_amount,
      current_driver_phone,
      tried_drivers
    `)
    .eq('id', Number(jobId))
    .single();

  if (error || !ride) {
    console.log('[getJobOrRebuildFromDb] not found', {
      jobId,
      error: error?.message || null,
    });
    return { jobId, job: null, ride: null };
  }

  // 3) Rebuild RAM job
  job = {
    jobId,
    pickup: ride.pickup,
    destination: ride.destination,
    paymentMethod: ride.payment_method || 'cash',
    pickupLat: ride.pickup_lat,
    pickupLng: ride.pickup_lng,
    riderPhone: ride.rider_phone,
    currentDriverPhone: ride.current_driver_phone || null,

    // keep both forms if your code uses both
    triedDrivers: Array.isArray(ride.tried_drivers) ? ride.tried_drivers : [],
    excludePhones: new Set(Array.isArray(ride.tried_drivers) ? ride.tried_drivers : []),

    // important for later code
    candidates: [],
  };

  upsertJob(jobId, job);

  console.log('[getJobOrRebuildFromDb] rebuilt from DB', {
    jobId,
    currentDriverPhone: job.currentDriverPhone,
    excludePhones: [...job.excludePhones],
  });

  return { jobId, job, ride };
}


///////////////////////////////////
if (!process.env.WEBSITE_SITE_NAME) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

console.log('[ENV]', {
  WEBSITE_SITE_NAME: process.env.WEBSITE_SITE_NAME || 'LOCAL',
  NODE_ENV: process.env.NODE_ENV || 'not-set',
});
const toNum = (v, d = 0) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : d;
};

const BASE_FARE= toNum(process.env.BASE_FARE, 0);
const PER_KM = toNum(process.env.PER_KM, 0);
const PER_MIN = toNum(process.env.PER_MIN, 0);
const TAX_MULTIPLIER = toNum(process.env.TAX_MULTIPLIER, 1);


//////////////// deployed recently 
//console.log('=== CASAGO API DEPLOY backend_azure 2025-12-28 ===');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => res.status(200).send('ok'));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PAGES = process.env.PUBLIC_PAGES_BASE || 'https://casago.netlify.app';
const MODES = new Set(['driving', 'walking', 'bicycling', 'transit']);

// ---------- HELPERS ----------

function randomId() {
  return Math.random().toString(36).substring(2, 10);
}
////////////////// Endof Timer /////////////////
async function geocodeAddress(address) {
  if (!address) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const { data } = await axios.get(url);
  if (data.status !== 'OK' || !data.results.length) return null;
  return data.results[0].geometry.location;
}
////////////////////// insert rider and solve ride processing .... //////
async function startNotifyDriverFlowFromRide({
  rideId,
  plat,
  plng,
  pickup,
  destination,
  riderName,
  riderPhone,
  paymentMethod,
  fare,

  ////////////////////  HERE ? /////

  
}) {
  // 🔑 ONE jobId everywhere = rides.id
  const jobId = String(rideId).trim();
  console.log('[notify-flow] jobId=', jobId);

  // Optional backward-compat
  try {
    await supabase.from('rides').update({ job_id: jobId }).eq('id', rideId);
  } catch (_) {}

  // ======================================================
  // 2) Find nearest drivers  ✅ (your existing code continues)
  // ======================================================
  console.log('[notify-driver] before dbgetNearestDrivers', { rideId: rideIdNum, type_vehicle });

  console.log('[DBGET IMPORT CHECK]', {
  typeofDbget: typeof dbgetNearestDrivers,
  name: dbgetNearestDrivers?.name
});
  const r = await dbgetNearestDrivers({
  lat: plat,
  lng: plng,
  type_vehicle,
  limit: 10,
});
console.log('[dbgetNearestDrivers OUT]', { rideId: rideIdNum, count: r?.length, sample: r[0] });

  return { ok: true, jobId };
}
// ---------- ROUTES ----------
app.get('/', (req, res) => res.status(200).send('OK'));
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));
// Basic probe
app.get('/', (_req, res) => res.send('ok'));
app.get('/health', (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// Twilio inbound SMS webhook (handles YES and PICKUP)
app.post('/sms-webhook', express.urlencoded({ extended: false }), (req, res) => {
  return handleSmsWebhook(req, res);
});

app.post('/sms', express.urlencoded({ extended: false }), (req, res) => {
  return handleSmsWebhook(req, res, jobs);
});

// Stripe checkout session NEW nEW updated
// ✅ UPDATED: /create-checkout-session
// - Inserts a ride row FIRST (so card rides won't be fare_amount=0)
// - Creates Stripe session
// - Saves stripe_session_id into rides
// - Returns session.url (unchanged for Flutter)

app.post('/create-checkout-session', async (req, res) => {
  try {
    const {
      amount,
      pickup,
      destination,
      riderName,
      riderPhone,
      type_vehicle,
      pickupLat,
      pickupLng,
      paymentMethod, // optional; you can ignore if not sent
    } = req.body || {};

    const amt = Number(amount);
    if (!amt || !pickup || !destination) {
      return res.status(400).json({ ok: false, error: 'missing fields' });
    }

    // 1) Create ride row first (so we can link it to Stripe session)
    const { data: ride, error: rideErr } = await supabase
      .from('rides')
      .insert({
        pickup,
        destination,
        rider_name: riderName ?? null,
        rider_phone: riderPhone ?? null,
        vehicle_type: type_vehicle ?? null,
        pickup_lat: pickupLat ?? null,
        pickup_lng: pickupLng ?? null,

        payment_method: 'card',
        fare_amount: amt,
        payout_status: 'pending',
        payment_status: 'pending',
        status: 'Pending',
      })
      .select('id')
      .single();

    if (rideErr || !ride?.id) {
      console.error('[create-checkout-session] rides insert error:', rideErr);
      return res.status(500).json({ ok: false, error: 'RIDE_INSERT_FAILED' });
    }

    const rideId = ride.id;

    // 2) Create Stripe session (keep your pages + metadata)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${PAGES}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PAGES}/cancel.html`,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'MAD', // keep as-is (but ensure your Stripe account supports it)
            unit_amount: Math.round(amt * 100),
            product_data: { name: `Ride: ${pickup} to ${destination}` },
          },
          quantity: 1,
        },
      ],
      metadata: {
        rideId: String(rideId), // ✅ important
        pickup,
        destination,
        riderName,
        riderPhone,
        type_vehicle,
        pickupLat,
        pickupLng,
      },
    });

    // 3) Save Stripe session id on the ride row (THIS is what you were missing)
    const { error: updErr } = await supabase
      .from('rides')
      .update({
        stripe_session_id: session.id,
        session_id: session.id, // optional: you also have session_id column
      })
      .eq('id', rideId);

    if (updErr) {
      console.error('[create-checkout-session] rides update error:', updErr);
      // Not fatal for redirect, but card finalize will fail without this.
    }

    return res.json({ ok: true, rideId, id: session.id, url: session.url });
  } catch (e) {
    console.error('=== STRIPE ERROR ===');
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: e.message || 'create-checkout failed',
    });
  }
});
/////////////////////////////////////////////////////////////////////

app.post("/after-payment", express.json(), async (req, res) => {
  try {
    const sessionId = (req.body?.session_id || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "session_id required" });

    // 1) Verify payment is paid
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(402).json({ ok: false, error: "NOT_PAID", payment_status: session.payment_status });
    }

    // 2) Fetch ride by stripe_session_id
    const { data: ride, error: rideErr } = await supabase
      .from("rides")
      .select("id, pickup, destination, rider_name, rider_phone, pickup_lat, pickup_lng, fare_amount, payment_method")
      .eq("stripe_session_id", sessionId)
      .single();

    if (rideErr || !ride?.id) {
      console.error("[after-payment] ride not found for session", { sessionId, err: rideErr?.message });
      return res.status(404).json({ ok: false, error: "RIDE_NOT_FOUND_FOR_SESSION" });
    }

    // 3) Mark paid
    await supabase.from("rides").update({ payment_status: "paid" }).eq("id", ride.id);

    // 4) Re-run the SAME logic as /notify-driver does (minimal duplication)
    // We call the same internal pieces: dbgetNearestDrivers(...) and your existing SMS/assignment code.
    const jobId = String(ride.id).trim();
    console.log("[after-payment] jobId=", jobId);

    const plat = ride.pickup_lat;
    const plng = ride.pickup_lng;

    console.log('[DBGET IMPORT CHECK]', {
  typeofDbget: typeof dbgetNearestDrivers,
  name: dbgetNearestDrivers?.name
});


    const candidatesRaw = await dbgetNearestDrivers({
      lat: plat,
      lng: plng,
      type_vehicle: null,
      limit: 5,
    });

    // ✅ IMPORTANT: paste the rest of your notify-driver logic here
    // starting from where you handle candidatesRaw, pick a driver, send SMS, update rides, etc.
    //
    // It should end with res.json({ ok: true, jobId, ... })
    //
    // For now:
    return res.json({ ok: true, jobId, candidates: candidatesRaw?.length ?? 0 });
  } catch (e) {
    console.error("[after-payment] error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// Distance calculator
app.post('/distance', async (req, res) => {
 const pickup = req.body.pickup;
const destination = req.body.destination;

// ✅ FIX HERE
const requestedVehicle =
  req.body.vehicle ??
  req.body.typeVehicle ??
  req.body.type_vehicle ??
  'Sedan';

console.log('[VEHICLE FIX]', { requestedVehicle });

  try {
    let { pickup, destination, mode = 'driving' } = req.body || {};
    if (!pickup || !destination)
      return res
        .status(400)
        .json({ ok: false, error: 'pickup and destination required' });

    if (!MODES.has(mode)) mode = 'driving';

    const pickupCoords = await geocodeAddress(pickup);
    const destCoords = await geocodeAddress(destination);
    if (!pickupCoords || !destCoords)
      return res.status(400).json({ ok: false, error: 'geocode failed' });

    const qs = new URLSearchParams({
      units: 'metric',
      origins: `${pickupCoords.lat},${pickupCoords.lng}`,
      destinations: `${destCoords.lat},${destCoords.lng}`,
      mode,
      key: process.env.GOOGLE_MAPS_API_KEY
    });

    if (mode === 'driving') qs.set('departure_time', 'now');

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${qs}`;
    const result = await fetch(url);
    const j = await result.json();

    const el = j?.rows?.[0]?.elements?.[0];
    if (j.status !== 'OK' || el.status !== 'OK')
      return res.status(404).json({ ok: false, error: 'no route' });
////TEMporarry Vesion to be removed ////////////////////////////////////
// Extract distance & duration from Google response

const meters = el.distance.value;
const seconds = el.duration.value;

const km = meters / 1000;
const minutes = Math.ceil(seconds / 60);

const requestedVehicle =
  req.body.vehicle ??
  req.body.typeVehicle ??
  req.body.type_vehicle ??
  'Sedan';

console.log('[FARE INPUT]', {
  pickup,
  destination,
  requestedVehicle
});
// Vehicle multipliers
const VEHICLE_MULT = {
  'SUV': 1.0,
  'MinVan': 1.1,
  'Sedav': 0.85,
  'Van': 1.4
};

// Distance factor function
//double distanceFactor(String vehicle, double km) {
  function distanceFactor(vehicle, km) {
  switch (vehicle) {
    case 'SUV':
      if (km < 10) return 1.0;       // base
      if (km >= 10 && km < 30) return 1.05;  // +0.5%
      if (km >= 30 && km < 60) return 0.90;  // -10%
      if (km >= 60 && km < 120) return 0.9; // -10%
      if (km >= 120 && km < 250) return 0.80; // -20%
      if (km >= 250 && km < 400) return 0.70; // -30%
      return 1.10; // +10%
    
    case 'MiniVan':
      if (km < 10) return 1.0;
      if (km >= 10 && km < 30) return 1.10;
      if (km >= 30 && km < 60) return 1.15;
      if (km >= 60 && km < 120) return 1.00;
      if (km >= 120 && km < 250) return 1.20;
      if (km >= 250 && km < 400) return 1.25;
      return 1.30;

    case 'Sedan':
      if (km < 10) return 1.0;
      if (km >= 10 && km < 30) return 1.10;
      if (km >= 30 && km < 60) return 1.10;
      if (km >= 60 && km < 120) return 1.10;
      if (km >= 120 && km < 250) return 1.20;
      if (km >= 250 && km < 400) return 1.30;
      return 1.60;

    case 'Van':
      if (km < 10) return 1.0;
      if (km >= 10 && km < 30) return 1.10;
      if (km >= 30 && km < 60) return 1.10;
      if (km >= 60 && km < 120) return 1.20;
      if (km >= 120 && km < 250) return 1.20;
      if (km >= 250 && km < 400) return 1.30;
      return 1.40;

    default:
      return 1.0;
  }
}
// Fare calculation
function calculateFare(vehicle, km, minutes, BASE_FARE, PER_KM, PER_MIN, TAX_MULTIPLIER) {
  const mult = VEHICLE_MULT[vehicle] ?? 1.0;
  const distFactor = distanceFactor(vehicle, km);
// ✅ ADD DEBUG HERE
  console.log('[FARE DEBUG]', {
    vehicle,
    mult,
    distFactor,
    km,
    minutes
  });
  console.log('[FARE DEBUG ROUTE]', {
  requestedVehicle,
  km,
  minutes
});
  let baseFare = BASE_FARE * mult * distFactor;
  let distanceCost = PER_KM * mult * distFactor * km;
  let timeCost = PER_MIN * mult * distFactor * minutes;

  let fare = (baseFare + distanceCost + timeCost) * TAX_MULTIPLIER;

  // Optional discount for km >= 14
  if (km >= 10) fare *= 0.90;

  // Custom adjustments
  if (km < 10) {
    if (vehicle === 'Van' || vehicle === 'Van') {
      fare *= 1.35; // +25%
    } else {
      fare *= 1.15; // +15%
    }
  } else if (km >= 120) {
    fare *= 0.90; // -20%
  }

  return Math.round(fare); // round to nearest integer
}

///////////////// End of temporrary Version ////////////////
// Inside your route, after km, minutes, and requestedVehicle are known:
const fare = calculateFare(
  requestedVehicle,
  km,
  minutes,
  BASE_FARE,
  PER_KM,
  PER_MIN,
  TAX_MULTIPLIER
);
return res.json({
  ok: true,
  distance_km: km,
  duration_min: minutes,
  fare: fare,                  // now this is defined
  pickup_lat: pickupCoords.lat,
  pickup_lng: pickupCoords.lng
});

} catch (e) {
  console.error('[DISTANCE FAILED]', e);
  return res.status(500).json({
    ok: false,
    error: 'distance failed',
    message: String(e?.message || e),
    name: e?.name || null,
    stackTop: String(e?.stack || '').split('\n').slice(0, 5)
  });
}
});
////////////////// rotateOffer //////////////////////
export async function rotateOffer({ jobId, ride }) {
  console.log('[rotateOffer ENTER]', {
    jobId,
    hasRide: !!ride,
    rideId: ride?.id ?? null,
    jobsSize: jobs.size,
    jobKeys: [...jobs.keys()],
  });

  //const job = jobs.get(jobId); in case did not work
  const { job } = await getJobOrRebuildFromDb(jobId);

if (!job) {
  console.log('[rotateOffer] job not found after rebuild', { jobId });
  return false;
}

// 1) Skip if a driver already claimed this ride
if (job.currentDriverPhone) {
  console.log('[rotateOffer] driver already claimed, skipping rotation', {
    jobId,
    currentDriverPhone: job.currentDriverPhone
  });
  return false;
}

// 2) Reload candidates if missing
// 2) Reload candidates if missing
if (!Array.isArray(job.candidates) || job.candidates.length === 0) {
  let rideRow = ride;

  // If passed ride is partial, fetch full row from DB
  if (!rideRow?.pickup_lat || !rideRow?.pickup_lng) {
    const { data, error } = await supabase
      .from('rides')
      .select('id, pickup_lat, pickup_lng, type_vehicle')
      .eq('id', Number(jobId))
      .single();

    if (error) {
      console.log('[rotateOffer] DB reload failed', {
        jobId,
        message: error.message,
      });
    }

    if (data) {
      rideRow = data;
    }
  }

  if (rideRow?.pickup_lat && rideRow?.pickup_lng) {
    const freshCandidates = await dbgetNearestDrivers({
      lat: Number(rideRow.pickup_lat),
      lng: Number(rideRow.pickup_lng),
      type_vehicle: rideRow.type_vehicle ?? null,
      limit: 10,
    });

    console.log('[rotateOffer DB RESULT]', {
      jobId,
      type: typeof freshCandidates,
      isArray: Array.isArray(freshCandidates),
    });

    job.candidates = Array.isArray(freshCandidates)
      ? freshCandidates
      : Array.isArray(freshCandidates?.drivers)
        ? freshCandidates.drivers
        : [];

    upsertJob(jobId, job);

    console.log('[rotateOffer CANDIDATES RELOADED]', {
      jobId,
      count: job.candidates.length,
      phones: job.candidates.map(d => d.phone),
    });
  } else {
    console.log('[rotateOffer] missing pickup coords for reload', {
      jobId,
      rideId: rideRow?.id ?? null,
      rideKeys: rideRow ? Object.keys(rideRow) : [],
    });
  }
} // <- closes the candidates reload block

// 3) Prepare candidates excluding previous drivers
const excludePhones = job.excludePhones || new Set();
const candidates = job.candidates || [];
const nextCandidate = candidates.find(d => !excludePhones.has(d.phone));
  if (!nextCandidate) {
    console.log('[rotateOffer] no claimable driver', { jobId, exclude: [...excludePhones] });
    return false;
  }

  const nextPhone = nextCandidate.phone;
  const now = Date.now();
  const lastOfferMs = job.lastOfferMs?.[nextPhone] || 0;
  const MIN_ROTATE_MS = 0;

  // 4) Update DB + RAM for next rotation attempt
const triedNext = Array.from(excludePhones);

const { data: rotateUpdData, error: rotateUpdError } = await supabase
  .from('rides')
  .update({
    status: 'PendingDriverConfirm',
    current_driver_phone: nextPhone || null,
    notify_sent_at: new Date().toISOString(),
    tried_drivers: triedNext,
  })
  .eq('id', Number(jobId))
  .select('id, status, current_driver_phone')
  .maybeSingle();

if (rotateUpdError) {
  console.log('[rotateOffer DB UPDATE FAILED]', {
    jobId,
    nextPhone,
    message: rotateUpdError.message,
  });
  await releaseDriverForRide({ driverPhone: nextPhone, rideId: jobId }).catch(() => {});
  return false;
}

job.currentDriverPhone = nextPhone;
job.driverPhone = nextPhone;
job.driver_phone = nextPhone;
job.lastOfferMs = job.lastOfferMs || {};
job.lastOfferMs[nextPhone] = now;
upsertJob(jobId, job);

// 5) Send offer SMS
console.log('[SEND OFFER] start', { jobId, to: nextPhone });

try {
  const msg = await sendOfferSMS(nextPhone, ride);

  console.log('[SEND OFFER] ok', { jobId, to: nextPhone, sid: msg.sid });
} catch (offerErr) {
  console.log('[rotateOffer] offer update failed', { jobId, err: offerErr.message });
  await releaseDriverForRide({ driverPhone: nextPhone, rideId: jobId }).catch(() => {});
  return false;
}

  // 6) Mark driver as excluded for future rotations until next ride
  excludePhones.add(nextPhone);
  job.excludePhones = excludePhones;
  upsertJob(jobId, job);

  console.log('[rotateOffer] offered', { jobId, prevPhone: job.prevPhone, nextPhone });
  return true;
}
///////////////////////////////////
app.post('/notify-driver', async (req, res) => {
  try {
    // 1) Parse inputs
    const pickup = req.body?.pickup ?? req.body?.pickup_address ?? req.body?.from ?? null;
    const destination = req.body?.destination ?? req.body?.dropoff ?? req.body?.to ?? null;
    const riderName = req.body?.rider_name ?? req.body?.riderName ?? null;
    const riderPhone = req.body?.rider_phone ?? req.body?.riderPhone ?? null;

    const paymentMethod = (req.body?.payment_method ?? req.body?.paymentMethod ?? 'cash');
    const fare = Number(req.body?.fare_amount ?? req.body?.fare ?? 0);

    const plat = Number(req.body?.pickup_lat ?? req.body?.pickupLat ?? req.body?.plat);
    const plng = Number(req.body?.pickup_lng ?? req.body?.pickupLng ?? req.body?.plng);
const typeVehicleRaw =
  req.body?.type_vehicle ??
  req.body?.vehicle_type ??
  req.body?.selectedVehicleType ??
  req.body?.typeVehicle ??
  null;

const type_vehicle = normalizeVehicleType(typeVehicleRaw);

console.log('[notify-driver TYPE]', {
  bodyTypeVehicle: req.body?.type_vehicle,
  bodyVehicleType: req.body?.vehicle_type,
  bodySelectedVehicleType: req.body?.selectedVehicleType,
  bodyTypeVehicleCamel: req.body?.typeVehicle,
  raw: typeVehicleRaw,
  normalized: type_vehicle,
});
    // 2) Validate BEFORE DB
    if (!pickup || !destination || !riderPhone || !Number.isFinite(plat) || !Number.isFinite(plng)) {
      return res.status(400).json({ ok: false, error: 'BAD_INPUT' });
    }

    // 3) Insert ride FIRST (so rideId exists)
    const { data: ride, error: rideErr } = await supabase
      .from('rides')
      .insert({
        pickup,
        destination,
        rider_name: riderName ?? null,
        rider_phone: riderPhone,
        pickup_lat: plat,
        pickup_lng: plng,
        payment_method: paymentMethod,
        fare_amount: fare,
        status: 'Pending',
        tried_drivers: [],
      })
      .select('id, tried_drivers')
      .single();

    if (rideErr || !ride?.id) {
      console.error('[RIDES] insert error:', rideErr?.message || rideErr);
      return res.status(500).json({ ok: false, error: 'RIDE_INSERT_FAILED' });
    }

    // 4) NOW it is safe to derive IDs/timestamps
    const nowIso = new Date().toISOString();
    const rideIdNum = Number(ride.id);
    const jobId = String(rideIdNum);

    const tried0 = Array.isArray(ride.tried_drivers) ? ride.tried_drivers : [];
    const triedIds = tried0.map((x) => Number(x)).filter(Number.isFinite);

    // 5) Now safe: freshness + driver fetch
    const lastSeenSeconds = Number(process.env.DRIVER_LAST_SEEN_SECONDS || 7200);
    const cutoffIso = new Date(Date.now() - lastSeenSeconds * 1000).toISOString();
const r = await dbgetNearestDrivers({
  lat: plat,
  lng: plng,
  type_vehicle,
  limit: 10,
});

const candidates =
  Array.isArray(r) ? r :
  Array.isArray(r?.drivers) ? r.drivers :
  Array.isArray(r?.data) ? r.data :
  Array.isArray(r?.candidates) ? r.candidates :
  [];
console.log('[dbgetNearestDrivers FULL]', candidates.map(d => ({
  id: d?.id ?? d?.driver_id,
  phone: d?.phone ?? d?.driver_phone ?? d?.current_driver_phone,
  lat: d?.lat,
  lng: d?.lng,
  distance_km: d?.distance_km ?? d?.distance ?? null,
  last_seen: d?.last_seen ?? null,
  current_ride_id: d?.current_ride_id ?? null,
  type_vehicle: d?.type_vehicle ?? null,
})));
console.log('[dbgetNearestDrivers OUT]', { rideId: rideIdNum, count: candidates.length, sample: candidates[0] });

if (!candidates.length) {
  await supabase.from('rides').update({ status: 'NoDrivers' }).eq('id', rideIdNum);
  return res.status(200).json({ ok: false, error: 'No drivers available', candidates: 0, jobId });
}
let chosen = null;

for (const d of candidates) {
  const driverIdNum = Number(d?.id ?? d?.driver_id ?? d?.notified_driver_id);
  const phoneE164 = String(d?.phone ?? d?.driver_phone ?? d?.current_driver_phone ?? '').trim();

  if (!Number.isFinite(driverIdNum)) continue;
  if (triedIds.includes(driverIdNum)) continue;

  const claimRes = await claimDriverForRide({ driverId: driverIdNum, rideId: rideIdNum });
  if (!claimRes?.ok) continue;

  const triedNext = [...new Set([...triedIds, phoneE164])];
  const nowIso = new Date().toISOString();

  // A) index fix BEFORE setting current_driver_phone
  const ACTIVE_STATUSES = ['Pending', 'PendingDriverConfirm', 'DriverConfirmed', 'PickedUp', 'Paid'];
  await supabase
    .from('rides')
    .update({ status: 'Cancelled', current_driver_phone: null, notified_driver_id: null, driver_id: null })
    .eq('current_driver_phone', phoneE164)
    .in('status', ACTIVE_STATUSES)
    .neq('id', rideIdNum);

  // Update ride (capture error + 0-row update)
  const { data: updData, error: updError } = await supabase
    .from('rides')
    .update({
      status: 'PendingDriverConfirm',
      current_driver_phone: phoneE164 || null,
      notified_driver_id: driverIdNum,
      notify_sent_at: nowIso,
      tried_drivers: triedNext,
    })
    .eq('id', rideIdNum)
    .is('current_driver_phone', null)
    .in('status', ['Pending'])
    .select('id, notify_sent_at, status')
    .maybeSingle();

  if (updError || !updData) {
    console.error('Error updating ride:', updError?.message || 'updated 0 rows');
    await releaseDriverForRide({ rideId: rideIdNum, driverPhone: phoneE164 }).catch(() => {});
    return res.status(200).json({ ok: false, error: 'offer_persist_failed', jobId });
  }

  // success
 // success
chosen = { id: driverIdNum, phone: phoneE164 };

const armedNotifySentAt = nowIso;

const currentJob = {
  rideId: rideIdNum,
  driverId: driverIdNum,
  driverPhone: phoneE164,
  armedNotifySentAt,
  triedDrivers: triedNext,
};

console.log('[SEND OFFER] start', { jobId: String(rideIdNum), to: phoneE164 });

try {
  const msg = await sendSms({
    to: phoneE164,
    body:
      `New ride/Nouvelle course.\n` +
      `Answer Yes/ OUI.\n` +
      `Job ID: ${rideIdNum}`
  });

  console.log('[SEND OFFER] ok', {
    jobId: String(rideIdNum),
    to: phoneE164,
    sid: msg?.sid,
    status: msg?.status,
    hasSid: !!msg?.sid,
  });
} catch (sendErr) {
  console.error('[SEND OFFER] fail', {
    jobId: String(rideIdNum),
    to: phoneE164,
    err: sendErr?.message || sendErr,
  });

  await supabase
    .from('rides')
    .update({
      status: 'Pending',
      current_driver_phone: null,
      notified_driver_id: null,
    })
    .eq('id', rideIdNum);

  await releaseDriverForRide({
    rideId: rideIdNum,
    driverPhone: phoneE164,
  }).catch(() => {});

  continue;
}

// Schedule timeout without leaking braces to the for/try structure
setTimeout(() => {
  (async () => {
    try {
      const { data: rideNow, error: rideErr } = await supabase
        .from('rides')
        .select('id, status, current_driver_phone, notify_sent_at')
        .eq('id', rideIdNum)
        .maybeSingle();

      if (rideErr || !rideNow) return;
      if (rideNow.status !== 'PendingDriverConfirm') return;

      // If there is a newer offer, do nothing
      const sentAtTime = rideNow.notify_sent_at
        ? new Date(rideNow.notify_sent_at).getTime()
        : 0;

      const armedTime = armedNotifySentAt
        ? new Date(armedNotifySentAt).getTime()
        : 0;

      if (sentAtTime > armedTime) return;

      // IMPORTANT: capture previous phone BEFORE clearing the ride row
      const prevPhone = String(rideNow.current_driver_phone || '').trim();

      // Unlock the ride (back to Pending) ONLY if it is still locked to this same driver
      // Unlock the ride (back to Pending) ONLY if it is still locked to this same driver
const { data: unlockedRows, error: unlockError } = await supabase
  .from('rides')
  .update({
    status: 'Pending',
    current_driver_phone: null,
    notified_driver_id: null,
  })
  .eq('id', rideIdNum)
  .eq('current_driver_phone', prevPhone)
  .eq('status', 'PendingDriverConfirm')
  .select('id, status, current_driver_phone');

if (unlockError) {
  console.log('[TIMEOUT] unlock failed', {
    rideIdNum,
    prevPhone,
    message: unlockError.message,
  });
  return;
}

if (!unlockedRows || !unlockedRows.length) {
  console.log('[TIMEOUT] unlock skipped - ride no longer matched timeout conditions', {
    rideIdNum,
    prevPhone,
  });
  return;
}
      // Release driver
   //   if (prevPhone) {
    //    await releaseDriverForRide({
   //       rideId: rideIdNum,
   //       driverPhone: prevPhone,
   //     }).catch(() => {});
  //    }

      // Rotate next and FORCE previous phone into exclude logic
 //     await rotateOffer(String(rideIdNum), { prevPhone });
 ////////////// update why search another driver did not continue /////
// Release timed-out driver
if (prevPhone) {
  const releaseRes = await releaseDriverForRide({
    rideId: rideIdNum,
    driverPhone: prevPhone,
  }).catch(() => null);

  console.log('[RELEASE RESULT]', releaseRes);
}

// Clear RAM state for timed-out driver before rotating
//const timedOutJob = jobs.get(String(rideIdNum));
const { job: timedOutJob } = await getJobOrRebuildFromDb(String(rideIdNum));

if (timedOutJob) {
  timedOutJob.excludePhones = timedOutJob.excludePhones || new Set();
  timedOutJob.excludePhones.add(prevPhone);
  timedOutJob.prevPhone = prevPhone;
  timedOutJob.currentDriverPhone = null;
  upsertJob(String(rideIdNum), timedOutJob);
}
console.log('[TIMEOUT JOB AFTER UPDATE]', {
  rideIdNum,
  jobExists: jobs.has(String(rideIdNum)),
  keys: [...jobs.keys()],
});
// Rotate to next driver
await rotateOffer({ jobId: String(rideIdNum), ride });
 ////////////////////////////////////////////////
    } catch (e) {
      console.error('[TIMEOUT] handler failed', e?.message || e);
    }
  })();
}, 60_000);

      chosen = { id: driverIdNum, phone: phoneE164 };
      break; // exit the loop – driver assigned
    }

    // ========== 10. Final response ==========
    if (chosen) {
      return res.status(200).json({ ok: true, jobId, driver: chosen });
    } else {
      // No driver could be claimed – mark ride as NoDrivers
      await supabase.from('rides').update({ status: 'NoDrivers' }).eq('id', rideIdNum);
      return res.status(200).json({ ok: false, error: 'No driver available' });
    }
  } catch (outerErr) {
    console.error('[notify-driver] fatal', outerErr.stack);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});
// Debug endpoint to verify deployed version

app.get('/version', (_req, res) => {
  res.json({
    version: "2026-01-02-just-in-time",
    smsHandler: "step-by-step",
    time: new Date().toISOString()
  });
});
///////////////////////
export async function sendOffer(jobId) {
  jobId = String(jobId);

  // 1) Try RAM
  //let job = jobs.get(jobId);
  const { job } = await getJobOrRebuildFromDb(jobId);
  // 2) DB fallback if RAM missing
  if (!job) {
    const { data: ride, error } = await supabase
      .from('rides')
      .select(`
        id,
        pickup,
        destination,
        payment_method,
        pickup_lat,
        pickup_lng,
        rider_phone,
        current_driver_phone,
        tried_drivers,
        type_vehicle
      `)
      .eq('id', Number(jobId))
      .single();

    if (error || !ride) {
      console.warn('[sendOffer] job not found (RAM+DB)', { jobId, error: error?.message });
      return false;
    }

    job = {
  jobId,
  pickup: ride.pickup,
  destination: ride.destination,
  fareAmount: Number(ride.fare_amount || 0),
  paymentMethod: ride.payment_method || 'cash',
  pickupLat: ride.pickup_lat,
  pickupLng: ride.pickup_lng,
  riderPhone: ride.rider_phone,
  currentDriverPhone: ride.current_driver_phone || null,
  triedDrivers: Array.isArray(ride.tried_drivers) ? ride.tried_drivers : [],
  typeVehicle: ride.type_vehicle || ride.vehicle_type || null,
};

    upsertJob(jobId, job);
  }

  // Fresh-start offer (reset)
  job.triedDrivers = Array.isArray(job.triedDrivers) ? job.triedDrivers : [];
  job.currentDriverPhone = null;
  upsertJob(jobId, job);
  const ok = await rotateOffer(jobId);
  console.log('[sendOffer] result', { jobId, ok });
  return ok;
}

////////////////////////////

// Driver heartbeat
// server.js
app.post('/driver/heartbeat', async (req, res) => {
  console.log('[HB RAW]', { ct: req.headers['content-type'], body: req.body });

  try {
    // Accept either id/driver_id or phone/driverPhone
    const idRaw =
      req.body?.id ??
      req.body?.driver_id ??
      req.body?.driverId ??
      req.body?.driverID ??
      null;

    const phoneRaw =
      req.body?.phone ??
      req.body?.driverPhone ??
      req.body?.current_driver_phone ??
      null;

    const latRaw = req.body?.lat;
    const lngRaw = req.body?.lng;

    const id = idRaw == null ? null : Number(idRaw);
    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    // Normalize phone (sms)
   const phoneNorm = normalizeSimplePhone(phoneRaw);

    console.log('[HB PARSED]', {
      idRaw,
      id_isNaN: idRaw != null ? Number.isNaN(id) : null,
      phoneRaw,
      phoneNorm,
      latRaw,
      lngRaw,
      lat_isNaN: Number.isNaN(lat),
      lng_isNaN: Number.isNaN(lng),
    });

    // validate
    const hasId = idRaw != null && Number.isFinite(id);
    const hasPhone = !!phoneNorm;

    if ((!hasId && !hasPhone) || Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({
        ok: false,
        reason: 'bad_input',
        need: 'id OR phone, plus numeric lat/lng',
      });
    }

    const nowIso = new Date().toISOString();

    // Build update query
    let q = supabase
      .from('drivers_table')
      .update({
        lat,
        lng,
        location_updated_at: nowIso,
        last_seen: nowIso,
        is_available: true, // keep if you want heartbeat to mark available
      });

    // Match row (prefer id, fallback to phone)
    if (hasId) {
      q = q.eq('id', id);
    } else {
      q = q.eq('phone', phoneNorm);
    }

    const { data, error } = await q.select(
      'id, phone, lat, lng, is_available, type_vehicle, location_updated_at, last_seen'
    );

    if (error) {
      console.error('[HB UPDATE ERROR]', error);
      return res
        .status(500)
        .json({ ok: false, reason: 'db_error', error: error.message });
    }

    if (!data || data.length === 0) {
      console.error('[HB NO ROW UPDATED]', { idRaw, phoneNorm });
      return res.status(404).json({
        ok: false,
        reason: 'driver_not_found',
        matchedBy: hasId ? 'id' : 'phone',
        id: hasId ? id : null,
        phone: hasPhone ? phoneNorm : null,
      });
    }

    return res.json({ ok: true, driver: data[0] });
  } catch (e) {
    console.error('[HB FAIL]', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[http] listening on 0.0.0.0:${PORT}`);
});


