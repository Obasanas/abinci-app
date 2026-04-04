// src/services/otp.service.js
// Handles OTP generation, sending via Africa's Talking, and verification

import AfricasTalking from 'africastalking';
import { sb } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const IS_SANDBOX = process.env.NODE_ENV !== 'production';

// Initialise Africa's Talking
const at = AfricasTalking({
  username: process.env.AT_USERNAME,
  apiKey:   process.env.AT_API_KEY,
});
const sms = at.SMS;

// ── Helpers ──────────────────────────────────────────────────

/** Normalise Nigerian phone to E.164 format: 08012345678 → +2348012345678 */
export function normalisePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234')) return '+' + digits;
  if (digits.startsWith('0'))   return '+234' + digits.slice(1);
  if (digits.length === 10)     return '+234' + digits;
  return '+' + digits;
}

/** Generate a 4-digit numeric OTP */
function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ── Send OTP ─────────────────────────────────────────────────

export async function sendOTP(rawPhone) {
  const phone = normalisePhone(rawPhone);
  const code  = generateCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY * 60 * 1000).toISOString();

  // Invalidate any existing unused OTPs for this phone
  await sb.from('otp_codes')
    .update({ used: true })
    .eq('phone', phone)
    .eq('used', false);

  // Store new OTP
  const { error: insertErr } = await sb.from('otp_codes').insert({
    phone,
    code,
    expires_at: expiresAt,
    used: false,
  });

  if (insertErr) {
    logger.error('Failed to store OTP', { phone, error: insertErr.message });
    throw new Error('Could not generate OTP. Try again.');
  }

  // Send SMS
  if (IS_SANDBOX) {
    // In sandbox/dev mode skip real SMS, just log the code
    logger.info(`[SANDBOX] OTP for ${phone}: ${code}`);
  } else {
    try {
      const result = await sms.send({
        to:      [phone],
        message: `Your VendorHub code is: ${code}. Valid for ${OTP_EXPIRY} minutes. Do not share this code.`,
        from:    process.env.AT_SENDER_ID || undefined,
      });
      logger.info('SMS sent', { phone, result: result.SMSMessageData?.Recipients?.[0]?.status });
    } catch (smsErr) {
      logger.error('SMS send failed', { phone, error: smsErr.message });
      // Clean up stored OTP so user can retry
      await sb.from('otp_codes').update({ used: true }).eq('phone', phone).eq('code', code);
      throw new Error('Failed to send SMS. Please try again.');
    }
  }

  return { phone, expiresAt };
}

// ── Verify OTP ───────────────────────────────────────────────

export async function verifyOTP(rawPhone, code) {
  const phone = normalisePhone(rawPhone);

  const { data: otp, error } = await sb.from('otp_codes')
    .select('*')
    .eq('phone', phone)
    .eq('code', code.trim())
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('OTP lookup error', { error: error.message });
    throw new Error('Verification error. Try again.');
  }

  if (!otp) {
    return { valid: false, reason: 'Invalid or expired code' };
  }

  // Mark as used
  await sb.from('otp_codes').update({ used: true }).eq('id', otp.id);

  return { valid: true, phone };
}
