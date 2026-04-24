// sms.js (ESM)
console.log('LOADED sms.js VERSION: PICKUP-TIMEOUT-MINUTES-579');

import { dbgetNearestDrivers } from './database.js';
import { releaseDriverForRide } from './database.js';
import { supabase } from './database.js';
//import fetch from 'node-fetch';
import twilio from 'twilio';
import { jobs, upsertJob } from './jobs.js';
import { updateRide } from './database.js';
//////////////////////////////
console.log('[sms.js] jobs import type=', typeof jobs, 'isMap=', jobs instanceof Map);

/////////////////////////////
function normalizeVehicleType(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();

  // Most specific first
  if (s.includes('SUV') || s.includes('suv') || s.includes('SUV')) {
    return 'SUV';
  }

  if (s.includes('MiniVan') || s.includes('MiniVan') || s.includes('MiniVan') || s === 'MiniVan') {
    return 'MiniVan';
  }

  if (s.includes('Small')) return 'Small';
  if (s.includes('van') || s.includes('vane') || s.includes('fourgon')) return 'Van';

  return null;
}
/////////////// Export ////////


////////////// supabase helper ///////////////////////
async function getRideById(jobId) {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('id', Number(jobId))
    .single();

  if (error) throw error;
  return data;
}
///////////////////////////////////////////////
async function findLatestRideIdForDriver({ driverPhone, statuses }) {
  const { data, error } = await supabase
    .from('rides')
    .select('id')
    .eq('current_driver_phone', driverPhone)
    .in('status', statuses)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[findLatestRideIdForDriver] failed', { driverPhone, statuses, error });
    return null;
  }
  return data?.id ? String(data.id) : null;
}

//////////////////////////////////////////////////////////
async function findLatestRideForDriver({ driverPhone, statuses }) {
  const { data, error } = await supabase
    .from('rides')
    .select('id, status, rider_phone, pickup, destination, payment_method, current_driver_phone, tried_drivers, pickup_lat, pickup_lng')
    .eq('current_driver_phone', driverPhone)
    .in('status', statuses)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[sms] ride lookup failed', { driverPhone, statuses, error });
    return null;
  }

  return data ?? null;
}


/////////////////////////////////////////////////////////

// ✅ ADD ETA HELPERS HERE (GLOBAL SCOPE)
async function computeEtaMinutes({ driverLat, driverLng, pickupLat, pickupLng }) {
  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error('No Google key');

    const url =
      'https://maps.googleapis.com/maps/api/distancematrix/json' +
      `?origins=${driverLat},${driverLng}` +
      `&destinations=${pickupLat},${pickupLng}` +
      `&mode=driving&departure_time=now&key=${key}`;

    const r = await fetch(url);
    const data = await r.json();

    const el = data?.rows?.[0]?.elements?.[0];
    const seconds =
      el?.duration_in_traffic?.value ??
      el?.duration?.value;

    if (seconds) {
      return Math.max(1, Math.round(seconds / 60));
    }
  } catch (_) {}

  // fallback
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(pickupLat - driverLat);
  const dLng = toRad(pickupLng - driverLng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(driverLat)) *
      Math.cos(toRad(pickupLat)) *
      Math.sin(dLng / 2) ** 2;

  const km = 2 * R * Math.asin(Math.sqrt(a));
  return Math.max(1, Math.round((km / 25) * 60));
}

////////////End of helper ETA   //////////////////
const TW_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM = process.env.TWILIO_PHONE_NUMBER || '';
const MSSID = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
const STATUS_CALLBACK = process.env.TWILIO_STATUS_CALLBACK || '';

// Utility functions
export const e164 = (s) => String(s || '').replace(/[^\d+]/g, '');
export const isE164 = (n) => /^\+\d{7,15}$/.test(e164(n));

export const normalizePhone = (phone = '') => {
  if (!phone) return '';

  let cleaned = String(phone).replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return '+1' + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return '+' + cleaned;

  return cleaned;
};

// Twilio client
export const tw = twilio(TW_SID, TW_TOKEN);

// Other exports must come AFTER definitions
export {
  //sendSms,
  //handleSmsWebhook,
  formatRideOfferSms,
  sendOfferSMS,
};
///////////////////  NEW added 
// ============================================================
// DRIVER SMS COMMANDS 
// NO jobId in SMS — job resolved by driver phone
// ============================================================
function normalizeTxt(raw) {
  return (raw || '').trim().toUpperCase();
}

function parseDriverAction(raw) {
  const t = normalizeTxt(raw);

  // ACCEPT
  if (t === 'YES' || t === 'OUI') return 'ACCEPT';

  // CANCEL (before pickup only)
  if (t === 'CANCEL' || t === 'ANNULER') return 'CANCEL';

  // PICKED UP (irreversible)
  if (t === 'PICKEDUP' || t === 'PICKED UP' || t === 'RAMASSE') return 'PICKEDUP';

  // COMPLETE
  if (t === 'COMPLETE' || t === 'TERMINE') return 'COMPLETE';

  return null;
}
////////////////////////// New added ////////////////////////
/////////////////////////  Hellper  /////////
async function autoCancelAndRedispatch(jobId) {
  jobId = String(jobId);

  let job = jobs.get(jobId);
  let ride = null;

  // Always fallback to DB
  try {
    ride = await getRideById(jobId);
  } catch (e) {
    console.error('[autoCancel] cannot load ride from DB', e?.message || e);
  }

  // Nothing in RAM or DB → real exit
  if (!job && !ride) {
    console.warn(`[autoCancel] Job ${jobId} not found (RAM + DB).`);
    return;
  }

  // Rebuild RAM job if needed
  if (!job && ride) {
    job = {
      jobId,
      currentDriverPhone: ride.current_driver_phone,
      riderPhone: ride.rider_phone,
      triedDrivers: Array.isArray(ride.tried_drivers) ? ride.tried_drivers : [],
      pickup: ride.pickup,
      destination: ride.destination,
      paymentMethod: ride.payment_method || 'cash'
    };
    upsertJob(jobId, job);
  }

  // From here on, use DB as source of truth
  await updateRide(jobId, { status: 'Cancelled' }).catch(() => {});

  // Notify rider
  if (job.riderPhone) {
    await sendSms({
      to: job.riderPhone,
      body: 'The ride has been canceled.We are searching for another driver'
    }).catch(() => {});
  }

  // Continue redispatch
  await rotatePickup(jobId);
}
///////////////////////////////////
function resolveRiderPhone(job, ride) {
  return (
    job?.riderPhone ||
    job?.rider_phone ||
    ride?.rider_phone ||
    ride?.riderPhone ||
    null
  );
}

/////////////////////////////////////////////////////////////
function findActiveJobForDriver(fromPhone, jobs) {
  const fromN = normalizePhone(fromPhone);

  for (const [jobId, job] of jobs.entries()) {
    const p1 = normalizePhone(job?.currentDriverPhone || '');
    const p2 = normalizePhone(job?.driverPhone || '');
    const p3 = normalizePhone(job?.driver_phone || '');

    if (
      (p1 === fromN || p2 === fromN || p3 === fromN) &&
      !job.cancelled
    ) {
      return { jobId, job };
    }
  }

  return null;
}


/////////////// rotation function 
async function rotatePickup(jobId) {
  jobId = String(jobId);

  let job = jobs.get(jobId);
  let ride = null;

  try { ride = await getRideById(jobId); } catch {}

  if (!ride && !job) {
    console.warn(`[rotatePickup] Job ${jobId} not found (RAM+DB).`);
    return;
  }

  // Don’t rotate finished rides
  if (ride && (ride.status === 'Completed' || ride.status === 'Cancelled' || ride.completed_at)) {
    console.log('[rotatePickup] skip finished ride', { jobId, status: ride.status });
    return;
  }

  if (!job && ride) {
    job = {
      jobId,
      currentDriverPhone: ride.current_driver_phone,
      riderPhone: ride.rider_phone,
      triedDrivers: Array.isArray(ride.tried_drivers) ? ride.tried_drivers : [],
      pickupLat: ride.pickup_lat,
      pickupLng: ride.pickup_lng,
      pickup: ride.pickup,
      destination: ride.destination,
      paymentMethod: ride.payment_method || 'cash'
    };
    upsertJob(jobId, job);
  }

  // Mark search state (do NOT cancel)
// Mark search state (do NOT cancel)
if (ride) {
  await updateRide(jobId, { status: 'Pending' }).catch(() => {});
}

  // 3) Notify rider (searching next driver)
  
  try {
    if (job.riderPhone) {
      await sendSms({
        to: job.riderPhone,
        body: 'Driver did not confirm pickup / Chauffeur n a pas pas confirme. Searching for another/on cherche un autre…'
      });
      console.log('[rotatePickup] rider notified searching', { jobId, to: job.riderPhone });
    }
  } catch (e) {
    console.error('[rotatePickup] SMS to rider failed', e?.stack || e);
  }

  // 4) Persist tried driver in DB (NOT just RAM)
  const current = job.currentDriverPhone || ride?.current_driver_phone;
  const tried = new Set(Array.isArray(job.triedDrivers) ? job.triedDrivers : []);
  if (current) tried.add(current);

  job.triedDrivers = Array.from(tried);

  try {
    await updateRide(jobId, { tried_drivers: job.triedDrivers });
  } catch (e) {
    console.error('[rotatePickup] tried_drivers update failed', e?.stack || e);
  }

  // 5) Rotate offer (DB-first)
  console.log('[rotatePickup] calling rotateOffer', { jobId, triedDrivers: job.triedDrivers });

  try {
    const ok = await rotateOffer(jobId, job); // returns true/false
    console.log('[rotatePickup] rotateOffer result', { jobId, ok });

    if (!ok) {
      if (job.riderPhone) {
        await sendSms({
          to: job.riderPhone,
          body: 'No driver availaile /Aucun autre chauffeur disponible pour le moment.'
        }).catch(() => {});
      }
      await updateRide(jobId, { status: 'NoDriver' }).catch(() => {});
      console.log('[rotatePickup] no driver available', { jobId });
    }
  } catch (e) {
    console.error('[rotatePickup] rotateOffer failed', e?.stack || e);
  }
}
/////////////////////////////////////////
async function sendOfferSMS(to, pickup, destination, paymentMethod) {
  const payFR = paymentMethod === 'cash'
    ? 'Paiement: ESPECES'
    : 'Paiement: CARTE (paye en ligne)';
const payEN = paymentMethod === 'cash'
  ? 'Payment: Cash'
  : 'Payment: Card (paid online)';

const body =
  `New ride request\n` +
  `Pickup: ${pickup}\n` +
  `Destination: ${destination}\n\n` +
  `Reply YES or OUI to accept\n\n` +
  `${payEN}\n${payFR}`;
return sendSms({ to, body });
}

export async function sendSms({
  to,
  body,
}) {
  if (!to) return;

  const toE = e164(to);
  if (!isE164(toE)) throw new Error('NO_VALID_TO');
  if (!body) throw new Error('NO_BODY');

  const params = {
    to: toE,
    body,
  };

  if (MSSID) {
    params.messagingServiceSid = MSSID;
  } else {
    params.from = FROM;
  }

  if (STATUS_CALLBACK) {
    params.statusCallback = STATUS_CALLBACK;
  }

  console.log('[OUTBOUND SMS]', {
    to: params.to,
    from: params.from || null,
    mssid: params.messagingServiceSid || null,
    hasBody: !!params.body,
  });

  try {
    const r = await tw.messages.create(params);
    console.log('→ OUT', params.to, '| SID:', r.sid, '| status:', r.status);
    return r;
  } catch (e) {
    console.log('[TWILIO SMS FAILED]', {
      to: params.to,
      from: params.from || null,
      message: e?.message,
      status: e?.status,
      code: e?.code,
      moreInfo: e?.moreInfo,
      details: e?.details,
    });
    throw e;
  }
}
  ////////////////////////// Time out imple;entation /////////////////
 
// Inside sms.js
// sms.js
// ===================== SMS / WHATSAPP WEBHOOK =====================
export async function handleSmsWebhook(req, res) {
  // Twilio expects TwiML (XML) always.
  res.type('text/xml');

  // ---------------------------
  // Normalize inbound sender
  // ---------------------------
  const fromRaw = String(req.body.From || '').trim(); // "+1819..."
  const fromN = normalizePhone(fromRaw); // MUST end as "+E164"
  const txtRaw = String(req.body.Body || '').trim();
  const txt = txtRaw.toUpperCase();
  // Safe jobs map (RAM optional)
  const jobsSafe = (typeof jobs !== 'undefined' && jobs) ? jobs : new Map();

  console.log('[INBOUND HIT]', {
    url: req.originalUrl,
    From: fromRaw,
    FromN: fromN,
    Body: txtRaw,
  });

  console.log('[JOBS SNAPSHOT]', {
    size: jobsSafe.size,
    keys: Array.from(jobsSafe.keys()).slice(0, 10),
  });

  try {
    // ---------------------------
    // 1) Parse action (NO jobId version)
    // ---------------------------
const action = (() => {
  if (txt === 'YES' || txt === 'OUI') return 'ACCEPT';
  if (txt === 'CANCEL' || txt === 'ANNULER') return 'CANCEL';
  if (txt === 'PICKEDUP' || txt === 'PICKED UP' || txt === 'RAMASSE' || txt === 'RAMASSAGE') return 'PICKEDUP';
  if (txt === 'COMPLETE' || txt === 'FINISHED' || txt === 'TERMINE' || txt === 'FIN') return 'COMPLETE';
  return null;
})();

/////////////////////// changes for mistakes occur //////////////////
if (!action) {
  console.log('[HELP MESSAGE TRIGGERED]', { txt, action });
  return res
    .type('text/xml')
    .send(
      '<Response><Message>Commands: YES/OUI (accept), CANCEL/ANNULER (cancel), PICKEDUP/RAMASSE (pickup), COMPLETE/TERMINE (complete).</Message></Response>'
    );
}
///////////////////////// First seTimeout on accept /////////////////////////////////

    // ---------------------------
    // 2) Resolve jobId (DB-first for ACCEPT)
    let parsedJobId = null; // keep placeholder if later you support "OUI 727"
let found = null;

// Explicit job id path
if (parsedJobId) {
  const parsedId = String(parsedJobId);

  const { data: rideById, error: rideByIdErr } = await supabase
    .from('rides')
    .select('*')
    .eq('id', Number(parsedId))
    .maybeSingle();

  if (rideByIdErr) {
    console.log('[DB PICK BY ID ERR]', { parsedId, msg: rideByIdErr.message });
  }

  if (rideById?.id) {
    let ramJob = jobsSafe.get(parsedId);

    if (!ramJob) {
      ramJob = {
        jobId: parsedId,
        currentDriverPhone: normalizePhone(rideById.current_driver_phone),
        driverPhone: normalizePhone(rideById.current_driver_phone),
        riderPhone: rideById.rider_phone || null,
        triedDrivers: Array.isArray(rideById.tried_drivers) ? rideById.tried_drivers : [],
        pickup: rideById.pickup || null,
        destination: rideById.destination || null,
        paymentMethod: rideById.payment_method || 'cash',
        pickupLat: rideById.pickup_lat ?? null,
        pickupLng: rideById.pickup_lng ?? null,
        accepted: !!rideById.accepted_at || rideById.status === 'DriverConfirmed' || rideById.status === 'PickedUp' || rideById.status === 'Completed',
        pickedUp: !!rideById.pickedup_at || rideById.status === 'PickedUp' || rideById.status === 'Completed',
        completed: !!rideById.completed_at || rideById.status === 'Completed',
        cancelled: rideById.status === 'Cancelled',
        createdAt: Date.now(),
      };
      upsertJob(parsedId, ramJob);
    }

    found = { jobId: parsedId, job: ramJob };
  }
}

// No explicit id: DB first, RAM second
if (!found) {
  const ACTIVE_FOR_ACCEPT = ['Pending', 'PendingDriverConfirm'];
  const ACTIVE_FOR_PICKEDUP = ['DriverConfirmed'];
  const ACTIVE_FOR_COMPLETE = ['PickedUp'];
  const ACTIVE_FOR_CANCEL = ['Pending', 'PendingDriverConfirm', 'DriverConfirmed'];

  const pickStatuses =
    action === 'ACCEPT'   ? ACTIVE_FOR_ACCEPT :
    action === 'PICKEDUP' ? ACTIVE_FOR_PICKEDUP :
    action === 'COMPLETE' ? ACTIVE_FOR_COMPLETE :
    action === 'CANCEL'   ? ACTIVE_FOR_CANCEL :
                            ACTIVE_FOR_ACCEPT.concat(ACTIVE_FOR_PICKEDUP, ACTIVE_FOR_COMPLETE);

  const { data: ridePick, error: pickErr } = await supabase
    .from('rides')
    .select('*')
    .eq('current_driver_phone', fromN)
    .in('status', pickStatuses)
    .order('notify_sent_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pickErr) {
    console.log('[DB PICK ERR]', { action, fromN, msg: pickErr.message });
  }

  if (ridePick?.id) {
    const jid = String(ridePick.id);
    let ramJob = jobsSafe.get(jid);

    if (!ramJob) {
      ramJob = {
        jobId: jid,
        currentDriverPhone: normalizePhone(ridePick.current_driver_phone),
        driverPhone: normalizePhone(ridePick.current_driver_phone),
        riderPhone: ridePick.rider_phone || null,
        triedDrivers: Array.isArray(ridePick.tried_drivers) ? ridePick.tried_drivers : [],
        pickup: ridePick.pickup || null,
        destination: ridePick.destination || null,
        paymentMethod: ridePick.payment_method || 'cash',
        pickupLat: ridePick.pickup_lat ?? null,
        pickupLng: ridePick.pickup_lng ?? null,
        accepted: !!ridePick.accepted_at || ridePick.status === 'DriverConfirmed' || ridePick.status === 'PickedUp' || ridePick.status === 'Completed',
        pickedUp: !!ridePick.pickedup_at || ridePick.status === 'PickedUp' || ridePick.status === 'Completed',
        completed: !!ridePick.completed_at || ridePick.status === 'Completed',
        cancelled: ridePick.status === 'Cancelled',
        createdAt: Date.now(),
      };
      upsertJob(jid, ramJob);
      console.log('[WEBHOOK JOB REBUILT FROM DB]', {
        jobId: jid,
        fromN,
        status: ridePick.status,
        currentDriverPhone: ramJob.currentDriverPhone,
      });
    } else {
      ramJob.currentDriverPhone = normalizePhone(
        ramJob.currentDriverPhone ||
        ramJob.driverPhone ||
        ramJob.driver_phone ||
        ridePick.current_driver_phone
      );
      ramJob.driverPhone = ramJob.currentDriverPhone;
      ramJob.riderPhone = ramJob.riderPhone || ridePick.rider_phone || null;
      ramJob.cancelled = ridePick.status === 'Cancelled';
      upsertJob(jid, ramJob);
    }

    found = { jobId: jid, job: ramJob };
  }
}

// RAM fallback only if DB found nothing
if (!found) {
  const ramFound = findActiveJobForDriver(fromN, jobsSafe);
  if (ramFound) {
    found = ramFound;
    console.log('[WEBHOOK RAM FALLBACK HIT]', {
      jobId: ramFound.jobId,
      fromN,
    });
  }
}

if (!found) {
  console.log('[handleSmsWebhook] no matching job found', {
    fromN,
    action,
    jobsSize: jobsSafe.size,
    keys: [...jobsSafe.keys()],
  });
  return res.send('<Response></Response>');
}
    const { jobId, job } = found;
    console.log('[JOB PICKED]', { jobId, action, fromN });

    // ---------------------------
    // 3) DB lookup (guard)
    // ---------------------------
    let ride = null;
    let rideStatus = null;

    const { data: rr, error: rrErr } = await supabase
      .from('rides')
      .select('id, status, rider_phone, current_driver_phone, tried_drivers, pickup, pickup_lat, pickup_lng')
      .eq('id', Number(jobId))
      .single();

    if (rrErr || !rr) {
      console.log('[DB GUARD ERROR]', {
        jobId: String(jobId),
        action,
        message: rrErr?.message || 'NO_ROW',
      });
      return res.send('<Response></Response>');
    }

    ride = rr;
    rideStatus = ride?.status || null;

    console.log('[DB GUARD HIT]', {
      jobId: String(jobId),
      rideId: ride.id,
      status: rideStatus,
    });

    // Cleanup RAM if ride is already terminal
    if (rideStatus === 'Completed' || rideStatus === 'Cancelled') {
      console.log('[RAM CLEANUP]', { jobId: String(jobId), rideStatus });
      jobsSafe.delete(String(jobId));
      return res.send('<Response></Response>');
    }

    // Irreversible rule: after pickup, CANCEL is ignored forever
    if (
      ride &&
      (ride.status === 'PickedUp' || ride.status === 'Completed') &&
      action === 'CANCEL'
    ) {
      return res.send('<Response></Response>');
    }

    // ===================== DRIVER ACCEPT =====================
    if (action === 'ACCEPT') {
      // (keep your existing ACCEPT block from here down)

  // Use one variable that can be resolved if missing
  let resolvedJobId = jobId;

  // ✅ If driver replied "OUI" without an id, pick latest active job for this driver
  if (!resolvedJobId) {
    resolvedJobId = pickLatestActiveJobForDriver(jobsSafe, fromN, action, { requireAccepted: false });

    console.log('[ACCEPT] resolved missing jobId from latest active job', {
      fromN,
      jobId: resolvedJobId,
      jobsSize: jobs?.size,
      keysSample: Array.from(jobs.keys()).slice(-10),
    });

    if (!resolvedJobId) {
      return res.send('<Response></Response>');
    }
  }

  // 🔒 ENSURE job exists (RAM → DB → rebuild)
  let job = jobs.get(String(resolvedJobId));
  let ride = null;

  if (!job) {
    ride = await getRideById(resolvedJobId).catch(() => null);

    if (!ride) {
      console.log('[ACCEPT] job not found (RAM + DB)', { jobId: resolvedJobId, fromN });
      return res.send('<Response></Response>');
    }

    job = {
      jobId: String(resolvedJobId),
      currentDriverPhone: ride.current_driver_phone,
      riderPhone: ride.rider_phone,
      triedDrivers: ride.tried_drivers ?? [],
      accepted: false,
      pickedUp: false,
      completed: false,

      riderNotifiedAccept: false,
      riderNotifiedPickup: false,
      riderNotifiedComplete: false,
      riderNotifiedCancel: false,

      createdAt: Date.now(),
    };

    upsertJob(String(resolvedJobId), job);
  }

  // ⛔ DUPLICATE ACCEPT GUARD (safe)
  if (job.accepted) {
    return res.send(
      '<Response><Message>Deja accepte. Repondez: RAMASSE /Message></Response>'
    );
  }

  // 🧾 LOG
  console.log('[ACCEPT ENTER]', {
    fromN,
    jobId: resolvedJobId,
    accepted: job.accepted,
    riderNotifiedAccept: job.riderNotifiedAccept,
    jobRiderPhone: job.riderPhone,
  });

  // ✅ MARK ACCEPTED (RAM)
  job.accepted = true;
  job.acceptedAt = Date.now();
  upsertJob(String(resolvedJobId), job);

  // ✅ PERSIST ACCEPT (DB)
// ✅ PERSIST ACCEPT (DB) - ATOMIC
const { data: driverRow } = await supabase
  .from('drivers_table')
  .select('id')
  .eq('phone', fromN)           // fromN must be normalized E164
  .maybeSingle();

const driverIdNum = Number(driverRow?.id);

if (!Number.isFinite(driverIdNum)) {
  console.error('[ACCEPT] driver not found for phone', { fromN });
  return res.send('<Response><Message>Driver introuvable.</Message></Response>');
}

const nowIso = new Date().toISOString();

const { data: acceptedRide, error: accErr } = await supabase
  .from('rides')
  .update({
    status: 'DriverConfirmed',
    accepted_at: nowIso,
    driver_id: driverIdNum,
  })
  
  .eq('id', Number(resolvedJobId))
  .eq('status', 'PendingDriverConfirm')
  .eq('current_driver_phone', fromN)
  .is('driver_id', null)
  .select('id,status,driver_id,current_driver_phone,accepted_at')
  .maybeSingle();

if (accErr || !acceptedRide) {
  console.error('[DB ACCEPT UPDATE FAILED]', {
    rideId: resolvedJobId,
    message: accErr?.message || 'no_row_updated',
  });

  return res.send('<Response><Message>Offre expired , expirée ou déjà attribuée.</Message></Response>');
}
// ✅ CLEAR OLD OFFER TIMEOUT HERE
if (job?.acceptTimeout) {
  clearTimeout(job.acceptTimeout);
  job.acceptTimeout = null;
}

//////////////////////////// send localication ///////////////////////////////////////
// 📍 Send pickup location link to driver (after ACCEPT)
    try {
        // pickup coords (fallbacks)
        const pLatRaw = job?.pickupLat ?? job?.pickup_lat ?? ride?.pickup_lat ?? ride?.pickupLat ?? null;
        const pLngRaw = job?.pickupLng ?? job?.pickup_lng ?? ride?.pickup_lng ?? ride?.pickupLng ?? null;

        const pLat = pLatRaw == null ? null : Number(pLatRaw);
        const pLng = pLngRaw == null ? null : Number(pLngRaw);

        // driver phone fallback (critical)
        const toDriver =
            job?.currentDriverPhone ??
            job?.driverPhone ??
            ride?.current_driver_phone ??
            ride?.driver_phone ??
            null;

        const mapUrl =
            (Number.isFinite(pLat) && Number.isFinite(pLng))
                ? `https://www.google.com/maps?q=${pLat},${pLng}`
                : null;

        if (!toDriver) {
            console.log('[ACCEPT] missing driver phone for pickup link', { jobId: resolvedJobId });
        } else if (!mapUrl) {
            console.log('[ACCEPT] missing pickup lat/lng for map link', { jobId: resolvedJobId, pLatRaw, pLngRaw });
        } else {
            await sendSms({
                to: toDriver,
                channel: 'whatsapp',
                body:
                    `📍 Localisation pickup:\n${mapUrl}\n\n` +
                    `Respond/Répondez: RAMASSE /When goods pickedup / quand la marchandise est chargée.`
            });

            console.log('[ACCEPT] pickup link sent to driver', { jobId: resolvedJobId, to: toDriver, mapUrl });
        }
    } catch (e) {
        console.log('[ACCEPT PICKUP LINK SMS FAIL]', {
            jobId: resolvedJobId,
            err: e?.message || e,
            to: job?.currentDriverPhone,
        });
    }


/////////////////////////////////////////////////////////////////////////////////
// Ensure riderPhone exists in this scope (prevents ReferenceError)
const riderPhone = job.riderPhone || job.rider_phone || null;

// Ensure driver phone is valid before sending
const driverPhone = job.currentDriverPhone || job.driverPhone || job.driver_phone || null;

// 1) Driver's ACCEPT SMS (non-fatal)
try {
  if (!driverPhone) throw new Error('driverPhone missing');

  await sendSms({
    to: driverPhone,
    body:
      `Accept/Accepté.\n` +
      `Respond/Répondez:\n` +
      `RAMASSE /(pickup)\n`
  });
} catch (e) {
  console.error('[ACCEPT ACK SMS FAIL]', e?.stack || e);
  // do not throw
}
// === schedule pickup timeout (must send RAMASSE before timeout) ===
//const etaMin = Number(job.etaToPickupMin ?? job.duration_min ?? job.etaMin ?? 5);
//const timeoutMs = Math.max(60_000, Math.round(etaMin * 1.5 * 60_000)); // minutes → ms
const rawEtaMin = Number(job.etaToPickupMin ?? job.duration_min ?? job.etaMin ?? 10);
const etaMin = Number.isFinite(rawEtaMin) && rawEtaMin > 0 ? rawEtaMin : 10;

const minTimeoutMs = Number(process.env.MIN_TIMEOUT_MS || 180_000);
const timeoutFactor = Number(process.env.PICKUP_TIMEOUT_FACTOR || 1.5);

const computedTimeoutMs = Math.round(etaMin * timeoutFactor * 60_000);
const timeoutMs = Math.max(minTimeoutMs, computedTimeoutMs);
//////////////  to verify which is used /////////////
console.log('[PICKUP TIMEOUT]', {
  etaToPickupMin: job.etaToPickupMin,
  duration_min: job.duration_min,
  etaMin: job.etaMin,
  rawEtaMin,
  etaMin,
  minTimeoutMs,
  timeoutFactor,
  computedTimeoutMs,
  timeoutMs,
});
//////////////////////////////////////////////////////////////////
if (job.pickupTimeout) clearTimeout(job.pickupTimeout);

job.pickupTimeout = setTimeout(() => {
  rotatePickup(String(resolvedJobId)).catch(e =>
    console.error('[rotatePickup] failed', e?.message || e)
  );
}, timeoutMs);

upsertJob(String(resolvedJobId), job);

console.log('[PICKUP TIMEOUT SET]', {
  jobId: String(resolvedJobId),
  etaMin,
  timeoutMs
});


////////////////////////////////////////////////////
  // 2) Rider's first SMS (after driver accepts)
  // >>> ADD THIS BLOCK HERE <<<
  // 2) Rider's first SMS (after driver accepts) + ETA
if (riderPhone) {
  try {
    const driverName =
      job.driverName || job.driver_name || job.driver?.name || 'Your driver / Votre chauffeur';

    const carPlate =
      job.carPlate || job.car_plate || job.driver?.car_plate || null;

    const driverLat = job.driverLat ?? job.driver_lat;
    const driverLng = job.driverLng ?? job.driver_lng;
    const pickupLat = job.pickupLat ?? job.pickup_lat;
    const pickupLng = job.pickupLng ?? job.pickup_lng;

    let etaMin2 = null;

    if (
      driverLat != null &&
      driverLng != null &&
      pickupLat != null &&
      pickupLng != null
    ) {
      etaMin2 = await computeEtaMinutes({
        driverLat,
        driverLng,
        pickupLat,
        pickupLng
      });
      job.etaMin = etaMin2; // cache (optional)
    }

    const plateText = carPlate ? `Car Plate: ${carPlate}\n` : '';
    const etaText = etaMin2 != null ? `ETA: ${etaMin2} min.` : 'ETA: bientôt.';

    const driverPhone2 =
      job.currentDriverPhone ||
      ride?.current_driver_phone ||
      job.driverPhone ||
      job.driver_phone ||
      null;

    const phoneText = driverPhone2 ? `Téléphone: ${driverPhone2}\n` : '';
   
  // Send "en route" once per driver (works with rotation)
if (job.lastEnRouteDriverPhone !== job.currentDriverPhone) {
  const { data: driverRow, error: driverErr } = await supabase
    .from('drivers_table')
    .select('full_name, car_plate')
    .eq('phone', job.currentDriverPhone)
    .maybeSingle();

  if (driverErr) {
    console.log('[DRIVER LOOKUP ERROR]', driverErr.message);
  }

  const safeDriverName = String(driverRow?.full_name || '').trim();
  const safeCarPlate = String(driverRow?.car_plate || '').trim();
  const safeDriverPhone = String(job.currentDriverPhone || '').trim();

  const etaMinutes = Number(etaMin || 0);
  const safeEtaText =
    Number.isFinite(etaMinutes) && etaMinutes > 0
      ? `${Math.round(etaMinutes)} min`
      : 'soon / bientôt';

  const templateSid = process.env.TWILIO_WA_DRIVER_EN_ROUTE_TEMPLATE_SID;
  if (!templateSid) {
    throw new Error('NO_DRIVER_EN_ROUTE_TEMPLATE_SID');
  }
const riderMsgRes = await sendSms({
  to: riderPhone,
  body:
    `${safeDriverName || 'Your driver'} / ${safeDriverName || 'Votre chauffeur'}\n` +
    `Plate: ${safeCarPlate || 'N/A'} / Plaque: ${safeCarPlate || 'N/A'}\n` +
    `Phone: ${safeDriverPhone}\n` +
    `ETA: ${safeEtaText} / Arrivée estimée: ${safeEtaText}`,
});

  job.lastEnRouteDriverPhone = job.currentDriverPhone;

  console.log('[ACCEPT RIDER SMS SENT]', {
    to: riderPhone,
    sid: riderMsgRes?.sid,
    driverName: safeDriverName,
    carPlate: safeCarPlate,
    etaMinutes,
    templateSid,
  });
} else {
  console.log('[ACCEPT RIDER SMS SKIP SAME DRIVER]', {
    riderPhone,
    currentDriverPhone: job.currentDriverPhone,
  });
}

job.riderNotifiedAccept = true;
} catch (e) {
  console.log('[ACCEPT RIDER SMS FAILED]', {
    to: riderPhone,
    message: e?.message || e,
  });
}
} // end if (riderPhone)

return res.send('<Response></Response>');
} // end if (action === 'ACCEPT')
  // ===================== CANCEL =====================
else if (action === 'CANCEL') {
 return res.send(
  "<Response><Message>Cancellation is disabled. Reply PICKEDUP when loaded. / L'annulation est désactivée. Répondez RAMASSE lorsque la marchandise est chargée.</Message></Response>"
);
}

// ===================== PICKEDUP / RAMASSE =====================
else if (action === 'PICKEDUP') {
  // Resolve jobId (allow RAMASSE without id)
let resolvedJobId = jobId;

if (!resolvedJobId) {
  // 1️⃣ Try RAM first
  resolvedJobId = pickLatestActiveJobForDriver(jobsSafe, fromN, action)

  // 2️⃣ If RAM failed → DB fallback (Option A support)
  if (!resolvedJobId) {
    const ride = await findLatestRideForDriver({
      driverPhone: fromN,
      statuses: ['DriverConfirmed', 'Accepted'], // adjust if needed
    });

    resolvedJobId = ride?.id ? String(ride.id) : null;
  }

  console.log('[PICKEDUP] resolved missing jobId', {
    fromN,
    resolvedJobId,
  });

  if (!resolvedJobId) {
    return res.send('<Response></Response>');
  }
}


  // Load job from RAM or rebuild from DB
  let job = jobs.get(String(resolvedJobId));
  let ride = null;

  // Always load ride (needed for robust accepted check + DB update)
  ride = await getRideById(resolvedJobId).catch(() => null);
  if (!ride && !job) return res.send('<Response></Response>');

  if (!job) {
    // ✅ robust accepted detection (supports your 'DriverConfirmed' status)
    const st = String(ride?.status || '').toLowerCase();
    const accepted =
      !!ride?.accepted_at ||
      st === 'accepted' ||
      st.includes('confirm'); // matches 'driverconfirmed', 'driver_confirmed', 'driverconfirmed', etc.

    job = {
      jobId: String(resolvedJobId),
      currentDriverPhone: ride?.current_driver_phone ?? null,
      riderPhone: ride?.rider_phone ?? null,
      triedDrivers: ride?.tried_drivers ?? [],

      accepted,

      pickedUp: false,
      completed: false,

      riderNotifiedAccept: false,
      riderNotifiedPickup: false,
      riderNotifiedComplete: false,
      riderNotifiedCancel: false,

      createdAt: Date.now(),
    };

    upsertJob(String(resolvedJobId), job);
  } else {
    // If job exists but accepted is false, allow DB to override (handles restarts / partial RAM)
    if (!job.accepted && ride) {
      const st = String(ride.status || '').toLowerCase();
      const accepted =
        !!ride.accepted_at ||
        st === 'accepted' ||
        st.includes('confirm');

      if (accepted) {
        job.accepted = true;
        upsertJob(String(resolvedJobId), job);
        console.log('[PICKEDUP] accepted restored from DB', { jobId: resolvedJobId, status: ride.status });
      }
    }
  }
    ///////////////////////////////////to prevent twice ramasse /////////////////////////
    // If RAM says not accepted, check DB and sync RAM
    // If RAM says not accepted, check DB and sync RAM (use resolvedJobId)
    // If RAM job exists but accepted is false, try to restore from DB once
    if (job && job.accepted !== true) {
        try {
            const ride = await getRideById(resolvedJobId);

           // const acceptedFromDb = (ride?.status === 'Accepted' || ride?.status === 'PickedUp' || ride?.status === 'Completed');
            const acceptedFromDb =
  ride?.status === 'DriverConfirmed' ||
  ride?.status === 'PickedUp' ||
  ride?.status === 'Completed';
           if (acceptedFromDb) {
                job.accepted = true;
                upsertJob(String(resolvedJobId), job);
                console.log('[PICKEDUP] accepted restored from DB', {
                    jobId: resolvedJobId,
                    status: ride?.status,
                });
            }
        } catch (e) {
            console.log('[PICKEDUP] db restore failed', {
                jobId: resolvedJobId,
                err: e?.message || e,
            });
        }
    }

    // Clear pickup timeout if present
    if (job?.pickupTimeout) {
        clearTimeout(job.pickupTimeout);
        job.pickupTimeout = null;
    }

    console.log('[PICKEDUP ENTER]', {
        jobId: resolvedJobId,
        fromN,
        accepted: job?.accepted,
        pickedUp: job?.pickedUp,
        rideStatus: ride?.status,
        rideAcceptedAt: ride?.accepted_at,
    });

  if (!job.accepted) {
  return res.send(
    "<Response><Message>Please accept the ride first. / Veuillez accepter la course d'abord.</Message></Response>"
  );
}

if (job.pickedUp) {
  return res.send(
    "<Response><Message>Already marked as PICKEDUP ✅ / Déjà marqué RAMASSE ✅</Message></Response>"
  );
}

  // mark picked up
  job.pickedUp = true;
  job.pickedUpAt = Date.now();
  upsertJob(String(resolvedJobId), job);

  // DB update (best effort)
  if (job?.acceptTimeout) {
  clearTimeout(job.acceptTimeout);
  job.acceptTimeout = null;
}
  try {
    const rideId = ride?.id ?? Number(resolvedJobId);
    if (rideId) {
      const { error: updErr } = await supabase
        .from('rides')
        .update({ status: 'PickedUp', pickedup_at: new Date().toISOString() })
        .eq('id', rideId);

      if (updErr) console.log('[PICKEDUP DB UPDATE FAIL]', { rideId, message: updErr.message });
      else console.log('[PICKEDUP DB UPDATED]', { rideId });
    } else {
      console.log('[PICKEDUP] ride missing (skip DB update)', { jobId: resolvedJobId });
    }
  } catch (e) {
    console.log('[PICKEDUP DB EXCEPTION]', e?.message || e);
  }
  
  // Rider SMS #2
  const riderPhone = resolveRiderPhone(job, ride);
  console.log('[PICKEDUP riderPhone]', { riderPhone });

  if (riderPhone && !job.riderNotifiedPickup) {
    try {
      const msg = await sendSms({ to: riderPhone, body: "Pickup completed. / Ramassage effectué." });
      console.log('[PICKEDUP RIDER SMS SENT]', { to: riderPhone, sid: msg?.sid });
      job.riderNotifiedPickup = true;
    } catch (e) {
      console.log('[PICKEDUP RIDER SMS FAIL]', { to: riderPhone, message: e?.message || e });
    }
  }

  // Driver SMS confirmation
  try {
    const msg2 = await sendSms({
      to: job.currentDriverPhone,
      body: "Pickup confirmed. When the ride is finished, reply COMPLETE. / Ramassage confirmé. Lorsque la course est terminée, répondez TERMINE."
    });
    console.log('[PICKEDUP DRIVER SMS SENT]', { to: job.currentDriverPhone, sid: msg2?.sid });
  } catch (e) {
    console.log('[PICKEDUP DRIVER SMS FAIL]', { to: job.currentDriverPhone, message: e?.message || e });
  }

}

else if (action === 'COMPLETE') {

  // Resolve jobId (allow TERMINE without id)
 // Resolve jobId from DB first (source of truth)
 //const resolvedRideId = Number(job?.jobId ?? jobId);
let resolvedJobId = jobId;
//let resolvedRideId = Number(jobId);


if (!resolvedJobId) {
  const { data: ridePick, error: pickErr } = await supabase
    .from('rides')
    .select('id,status,current_driver_phone')
    .eq('current_driver_phone', fromN)
    .in('status', ['PickedUp'])   // allow only picked-up rides to be completed
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pickErr) console.log('[COMPLETE DB PICK ERR]', pickErr.message);

  resolvedJobId = ridePick?.id ? String(ridePick.id) : null;

  console.log('[COMPLETE] resolved missing jobId', { fromN, resolvedJobId });
  if (!resolvedJobId) return res.send('<Response></Response>');
}

// Load RAM job safely (non-fatal)
let job = jobsSafe.get(String(resolvedJobId)) || null;
const ride = await getRideById(resolvedJobId).catch(() => null);
if (ride?.id) resolvedJobId = String(ride.id);
else if (job?.jobId) resolvedJobId = String(job.jobId);
if (!ride && !job) return res.send('<Response></Response>');


  // Optional but recommended: rebuild job if missing
 if (!job && ride) {
  const st = String(ride.status || '');
  job = {
    jobId: String(ride.id),
    currentDriverPhone: ride.current_driver_phone,
    riderPhone: ride.rider_phone,
    accepted: st === 'DriverConfirmed' || st === 'PickedUp' || st === 'Completed' || !!ride.accepted_at,
    pickedUp: st === 'PickedUp' || st === 'Completed' || !!ride.pickedup_at,
    completed: st === 'Completed' || !!ride.completed_at,
    createdAt: Date.now(),
  };
  upsertJob(String(job.jobId), job);
}

  // Optional: DB overrides RAM flags
 if (ride && job) {
  const st = String(ride.status || '');

  const dbAccepted =
    st === 'DriverConfirmed' || st === 'PickedUp' || st === 'Completed' || !!ride.accepted_at;

  const dbPickedUp =
    st === 'PickedUp' || st === 'Completed' || !!ride.pickedup_at;

  const dbCompleted =
    st === 'Completed' || !!ride.completed_at;

  if (!job.accepted && dbAccepted) job.accepted = true;
  if (!job.pickedUp && dbPickedUp) job.pickedUp = true;
  if (!job.completed && dbCompleted) job.completed = true;
}

  // ✅ Now your checks are safe
 if (!job.accepted) {
  return res.send(
    "<Response><Message>Reply YES or OUI to accept first. / Répondez YES ou OUI pour accepter d'abord.</Message></Response>"
  );
}

if (!job.pickedUp) {
  return res.send(
    "<Response><Message>Confirm pickup first: PICKEDUP or RAMASSE. / Confirmez d'abord le ramassage : PICKEDUP ou RAMASSE.</Message></Response>"
  );
}

if (job.completed) {
  return res.send(
    "<Response><Message>Already completed ✅ / Déjà terminé ✅</Message></Response>"
  );
}

  // DB update (best effort)
  try {
    const rideId = ride?.id ?? Number(job?.jobId ?? jobId);
    if (rideId) {
      const { error: updErr } = await supabase
  .from('rides')
  .update({
    status: 'Completed',
    completed_at: new Date().toISOString(),
    current_driver_phone: null,
    notified_driver_id: null,
  })
  .eq('id', rideId);

if (updErr) {
  console.log('[COMPLETE DB UPDATE FAIL]', { id: rideId, message: updErr.message });
  return res.send('<Response><Message>Erreur DB (update complete).</Message></Response>');
} else {
  console.log('[COMPLETE DB UPDATED]', { id: rideId });
}
    } else {
      console.log('[COMPLETE] ride missing (skip DB update)', { jobId: job?.jobId ?? jobId });
    }
  } catch (e) {
    console.log('[COMPLETE] DB exception', e?.message || e);
    // Continue (do not block driver confirmation)
  }

  // stop stale timers first
  if (job?.acceptTimeout) {
    clearTimeout(job.acceptTimeout);
    job.acceptTimeout = null;
  }

  if (job?.pickupTimeout) {
    clearTimeout(job.pickupTimeout);
    job.pickupTimeout = null;
  }

  // 🔓 RELEASE DRIVER (once)
const resolvedRideId = ride?.id ?? Number(job?.jobId ?? jobId);

if (resolvedRideId) {
  const releaseRes = await releaseDriverForRide({
    driverPhone: fromN,
    rideId: Number(resolvedRideId),
  });

  if (releaseRes?.ok) {
    console.log('[DRIVER RELEASED]', {
      rideId: resolvedRideId,
      driverPhone: fromN,
      releaseRes,
    });
  } else {
    console.warn('[DRIVER NOT RELEASED]', {
      rideId: resolvedRideId,
      driverPhone: fromN,
      releaseRes,
    });
  }
}
// Mark completed in RAM
job.completed = true;
job.completedAt = Date.now();
upsertJob(String(job.jobId || jobId), job);

  // Fire-and-forget notifications (do not block TwiML response)
  setImmediate(async () => {
    try {
      await sendSms({
       to: job.currentDriverPhone,
       body: "Thank you. Please wait for the next delivery request. / Merci. Veuillez attendre la prochaine demande de livraison.",
       });
    } catch (e) {
      console.log('[COMPLETE] driver sms failed:', e?.message || e);
    }

    try {
      const riderPhone = job.riderPhone || job.rider_phone || ride?.rider_phone;
      if (riderPhone) {
       await sendSms({
       to: riderPhone,
       body: "Your ride is complete. Thank you for choosing Casago. / Votre course est terminée. Merci d’avoir choisi Casago.",
});
      }
    } catch (e) {
      console.log('[COMPLETE] rider sms failed:', e?.message || e);
    }
  });

  // ✅ TwiML reply to driver (instant)
  return res.send('<Response><Message>Completed Terminé confirmé ✅</Message></Response>');
}
// ===================== DEFAULT =====================
// ===================== DEFAULT =====================
else {
  console.log('[ROUTING DEFAULT]', { action, jobId });
  return res.send('<Response></Response>');
}

} catch (e) {
  console.error('[handleSmsWebhook] error:', e);
  return res.send('<Response><Message>Server error.</Message></Response>');
}
}
export async function acceptRide({ jobId, fromN }) {
  //const job = jobs.get(jobId); in case do not work
  const { job } = await getJobOrRebuildFromDb(jobId);
//if (!job) return false;
  if (!job) return { ok: false, reason: 'job_not_found' };

  const driverPhone = fromN;
  const nowMs = Date.now();
  const GRACE_MS = 90_000; // 90s grace window

  // Use DB claim timestamp or fallback to lastOfferMs in RAM
  const claimTime = job.claimedAtMs?.[driverPhone] || job.lastOfferMs?.[driverPhone] || 0;
  const withinGrace = nowMs - claimTime <= GRACE_MS;

  // Reject if driver is outside grace window and not the current driver
  if (!withinGrace && job.currentDriverPhone !== driverPhone) {
    console.log('[acceptRide] expired or already taken', { jobId, driverPhone });
    return { ok: false, reason: 'expired_or_taken' };
  }

  // Claim driver in DB if not already claimed
  const claim = await claimDriverForRide({
    driverId: job.driverMap[driverPhone],
    rideId: jobId
  });

  if (!claim.ok) {
    console.log('[acceptRide] claim failed', { jobId, driverPhone, detail: claim });
    return { ok: false, reason: 'claim_failed', detail: claim };
  }

  // Update ride in DB
  await supabase
    .from('rides')
    .update({
      status: 'DriverConfirmed',
      current_driver_phone: driverPhone,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', Number(jobId));

  // Clear pending timeouts / RAM rotation
  if (job.acceptTimeout) {
    clearTimeout(job.acceptTimeout);
    job.acceptTimeout = null;
  }

  job.currentDriverPhone = driverPhone;
  job.riderNotifiedAccept = false;
  upsertJob(jobId, job);

  console.log('[acceptRide] driver accepted', { jobId, driverPhone });
  return { ok: true };
}
  //////////////////////////////////
function formatRideOfferSms(job, jobId) {
  // normalize ID once (even if not used here yet)
  const id = String(jobId ?? job?.id ?? job?.jobId).trim();
  const pm = String(job?.payment_method || '').trim().toLowerCase();
const payEN =
  pm === 'cash'
    ? 'Payment: Cash'
    : 'Payment: Card (already paid online)';

const payFR =
  pm === 'cash'
    ? 'Paiement : Espèces'
    : 'Paiement : Carte (déjà payée en ligne)';

// Fare
const rawAmount = job?.fare_amount ?? job?.amount ?? job?.fare ?? null;

const fareLine =
  rawAmount == null || Number.isNaN(Number(rawAmount))
    ? '💰 Fare: coming soon / Tarif : bientôt\n\n'
    : `💰 Fare: ${Number(rawAmount).toFixed(2)} CAD / Tarif : ${Number(rawAmount).toFixed(2)} CAD\n\n`;

const body =
  `🚚 New ride / Nouvelle course\n\n` +
  `📍 Pickup: ${job.pickup}\n` +
  `➡️ Destination: ${job.destination}\n\n` +
  fareLine +
  `${payEN}\n${payFR}\n\n` +
  `Reply: YES or OUI to accept\n` +
  `Répondez : YES ou OUI pour accepter`;

return body;
}
