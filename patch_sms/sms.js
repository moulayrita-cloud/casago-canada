// sms.js (ESM)
import { supabase } from './database.js';
import fetch from 'node-fetch';
import twilio from 'twilio';
import { jobs } from './jobs.js';

const TW_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM = process.env.TWILIO_PHONE_NUMBER || '';
const MSSID = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
const STATUS_CALLBACK = process.env.TWILIO_STATUS_CALLBACK || '';

export {
  sendSms,
  normalizePhone,
  isE164,
  e164,
  handleSmsWebhook,
  formatRideOfferSms,
  sendOfferSMS,
};


export const tw = twilio(TW_SID, TW_TOKEN);
const e164 = (s) => String(s || '').replace(/[^\d+]/g, '');
const isE164 = (n) => /^\+\d{7,15}$/.test(e164(n));



function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return '+1' + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return '+' + cleaned;
  return cleaned;
}
/////////////// rotation function 
async function rotatePickup(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    console.warn(`[rotatePickup] Job ${jobId} not found.`);
    return;
  }

  console.warn(`[PICKUP TIMEOUT] Job ${jobId} — no pickup confirmation.`);

  // Mark in DB as pickup timeout
  try {
    await supabase
      .from('rides')
      .update({ status: 'PickupTimeout' })
      .eq('id', jobId);
  } catch (e) {
    console.error('[rotatePickup] DB update failed:', e);
  }

  // Notify rider
  try {
    await sendSms({
      to: job.riderPhone,
      body: `Driver did not confirm pickup. Searching for another driver…`
    });
  } catch (e) {
    console.error('[rotatePickup] SMS to rider failed:', e);
  }

  // Try to assign new driver
  try {
    await rotateOffer(jobId);
  } catch (e) {
    console.error('[rotatePickup] rotateOffer failed:', e);
  }
}

//////////////////////
async function sendOfferSMS(to, jobId, pickup, destination) {
  const body =
    `New ride request!\n` +
    `Pickup: ${pickup}\n` +
    `Destination: ${destination}\n` +
    `Reply YES ${jobId} to accept.`;

  return sendSms({ to, body });
}

async function sendSms({ to, body }) {
  const toE = e164(to);
  if (!isE164(toE)) throw new Error('NO_VALID_TO');
  const params = { to: toE, body: body || '' };
  if (MSSID) params.messagingServiceSid = MSSID;
  else params.from = FROM;
  if (STATUS_CALLBACK) params.statusCallback = STATUS_CALLBACK;
  const r = await tw.messages.create(params);
  console.log('→ SMS', toE, '| SID:', r.sid);
  return r;
}

// Twilio inbound webhook (handles YES / PICKUP)
// Twilio inbound webhook (handles YES <jobId>, YES, PICKUP <jobId>)
// Twilio inbound webhook (handles YES <id>, YES, PICKUP <id>, COMPLETE <id>)
async function handleSmsWebhook(req, res, jobs) {
  try {
    const from = req.body.From || '';
    const txt = (req.body.Body || '').trim().toUpperCase();
    const fromN = normalizePhone(from);

    console.log('[SMS IN]', fromN, '|', txt);

    let jobId = null;

    // =========================================================================
    // 1. ACCEPTANCE: YES <jobId>
    // =========================================================================
// Accept PICKEDUP <id> OR REPLY PICKEDUP <id>
      const acceptMatch = txt.match(/^YES\s+(\d+)$/i);
    if (acceptMatch) {
      jobId = acceptMatch[1]; // extract numeric ID
      console.log('[YES <id>] Parsed job:', jobId);
    }

    // =========================================================================
    // 2. ACCEPTANCE: YES (driver replying without jobId)
    // =========================================================================
    else if (txt === 'YES') {
      for (const [id, job] of jobs.entries()) {
        if (normalizePhone(job.currentDriverPhone) === fromN && !job.accepted) {
          jobId = id; // driver replying to active job
          console.log('[YES only] Using active job:', jobId);
          break;
        }
      }
      if (!jobId) {
        await sendSms({ to: from, body: 'No active job found for YES.' });
        return res.send('<Response></Response>');
      }
    }

    // =========================================================================
    // 3. PROCESS ACCEPTANCE FLOW
    // =========================================================================
    if (jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        await sendSms({ to: from, body: 'Invalid job ID or job expired.' });
        return res.send('<Response></Response>');
      }

      const curN = normalizePhone(job.currentDriverPhone);

      // Wrong driver is replying
      if (curN !== fromN) {
        console.log('[DENY ACCEPT] Wrong driver:', fromN, 'expected:', curN);
        await sendSms({ to: from, body: 'This offer is no longer available.' });
        return res.send('<Response></Response>');
      }

      // Accept the ride
      if (job.timeout) {
        clearTimeout(job.timeout);
        job.timeout = null;
      }

      job.accepted = true;
      job.acceptedAt = Date.now();
      jobs.set(jobId, job);
      
      // Start pickup monitor (1.5× ETA = ~90 seconds default)
// Ensure ETA is valid (min 2 minutes)
let effectiveEta = job.etaMinutes;
if (!effectiveEta || effectiveEta < 2) effectiveEta = 2;

// 1.5 × ETA, minimum 3 minutes
// Start pickup monitor (1.5× ETA)
const pickupTimeoutMs = Math.floor(job.etaMinutes * 1.5 * 60 * 1000);

job.pickupTimeout = setTimeout(() => {
  console.warn(
    `[PICKUP TIMEOUT] Job ${jobId} no pickup confirmation after ${pickupTimeoutMs / 1000}s`
  );
  rotatePickup(jobId);
}, pickupTimeoutMs);


      // Update DB: DriverConfirmed
      await supabase
        .from('rides')
        .update({
          status: 'DriverConfirmed',
          driver_id: job.currentDriverId,
          driver_phone: job.currentDriverPhone,
          notify_sent_at: new Date()
        })
        .eq('id', jobId);

      // Fetch driver details
      const { data: d } = await supabase
        .from('drivers_table')
        .select('full_name, lat, lng, car_model, car_plate')
        .eq('phone', curN)
        .single();

      job.driverName = d.full_name;
      job.car_model  = d.car_model;
      job.car_plate  = d.car_plate;

      // ETA calculation
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${d.lat},${d.lng}&destinations=${job.pickupLat},${job.pickupLng}&key=${apiKey}&departure_time=now`;

      const g = await fetch(url).then(r => r.json());
      const el = g?.rows?.[0]?.elements?.[0];
      const etaMin = el?.duration?.value ? Math.round(el.duration.value / 60) : null;

      job.etaMinutes = etaMin;
      jobs.set(jobId, job);

      // Notify rider
      await sendSms({
        to: job.riderPhone,
        body: `Driver ${job.driverName} (${job.car_model}, plate ${job.car_plate}) is on the way. ETA: ${etaMin ?? 'unknown'} mins.`
      });

      // Notify driver
      // Ask driver to confirm pickup
await sendSms({
  to: from,
  body: `Reply PICKEDUP ${jobId} when the rider is picked up.`
});


      return res.send('<Response></Response>');
    }

   // ----------------------------------------------------
// 4. PICKUP CONFIRMATION — RAMASSE <jobId>
// ----------------------------------------------------
const pickupMatch = txt.match(/^RAMASSE\s+(\d+)$/i);

if (pickupMatch) {
  jobId = pickupMatch[1];   // job ID is at index 1
  const job = jobs.get(jobId);
  if (!job) {
    await sendSms({ to: from, body: 'Invalid job ID.' });
    return res.send('<Response></Response>');
  }

  const fromN = normalizePhone(from);
  const curN  = normalizePhone(job.currentDriverPhone);

  // If wrong driver
  if (fromN !== curN) {
    await sendSms({ to: from, body: 'You are not assigned to this job.' });
    return res.send('<Response></Response>');
  }

  console.log(`[PICKUP CONFIRMED] Job ${jobId} by driver ${fromN}`);

  // Stop pickup timer
  if (job.pickupTimeout) {
    clearTimeout(job.pickupTimeout);
    job.pickupTimeout = null;
  }

  job.pickedUp = true;
  job.pickedUpAt = Date.now();
  jobs.set(jobId, job);

  await sendSms({ to: job.riderPhone, body: 'Pickup confirmed. Have a good trip.' });
  await sendSms({ to: from, body: 'Pickup confirmed.' });

  return res.send('<Response></Response>');
}



    // =========================================================================
    // 5. COMPLETION: COMPLETE <jobId>
    // =========================================================================
    const completeMatch = txt.match(/^COMPLETE\s+(\d+)$/i);
    if (completeMatch) {
      const cJobId = completeMatch[1];
      const job = jobs.get(cJobId);

      if (!job) {
        await sendSms({ to: from, body: 'Invalid completion code.' });
        return res.send('<Response></Response>');
      }

      const curN = normalizePhone(job.currentDriverPhone);
      if (curN !== fromN) {
        await sendSms({ to: from, body: 'You are not assigned to this job.' });
        return res.send('<Response></Response>');
      }

      // Update DB
      await supabase
        .from('rides')
        .update({ status: 'Completed' })
        .eq('id', cJobId);

      // Notify rider
      await sendSms({ to: job.riderPhone, body: 'Your ride is complete. Thank you!' });

      // Notify driver
      await sendSms({ to: from, body: 'Ride marked as complete.' });

      // Remove job from memory ONLY now
      jobs.delete(cJobId);

      console.log('[JOB REMOVED]', cJobId);

      return res.send('<Response></Response>');
    }

    // =========================================================================
    // 6. UNKNOWN COMMAND
    // =========================================================================
    await sendSms({ to: from, body: 'Commands: YES <id>, PICKUP <id>, COMPLETE <id>' });
    return res.send('<Response></Response>');

  } catch (e) {
    console.error('SMS webhook error:', e);
    return res
      .status(500)
      .type('text/xml')
      .send('<Response><Message>Error</Message></Response>');
  }
}
function formatRideOfferSms(job, jobId) {
  return (
    `New ride request!\n` +
    `Pickup: ${job.pickup}\n` +
    `Destination: ${job.destination}\n` +
    `Reply YES ${jobId} to accept`
  );
}


