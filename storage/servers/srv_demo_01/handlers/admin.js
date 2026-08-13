// ============================================================
// handlers/admin.js — ⚙️ ADMIN PANEL (OWNER + DEVELOPER)
// ============================================================
import { config, isAdminId } from '../config.js';
import * as db from '../database.js';
import { getSession, setSession, clearSession, adminGuard } from '../middleware.js';
import { addLimit, listUsers } from '../services/userService.js';
import { getStats } from '../services/paymentService.js';
import { checkApiHealth } from '../api.js';
import { adminMenuKeyboard, adminBackKeyboard } from '../keyboards.js';
import { escHtml, formatDateTime, userMention, formatDate } from '../helpers.js';
import { logger } from '../logger.js';

export async function adminMenu(ctx) {
  if (!adminGuard(ctx)) return;
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.reply('╭━━━━━━━━━━━━━━━━━━━━━━╮\n       ⚙️ ADMIN PANEL\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\nPilih menu:', {
    reply_markup: adminMenuKeyboard(),
  });
}

export async function adminUsers(ctx) {
  if (!adminGuard(ctx)) return;
  await ctx.answerCallbackQuery().catch(() => {});
  const users = listUsers(15);
  let text = '╭━━━━━━━━━━━━━━━━━━━━━━╮\n       👥 USERS\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n';
  if (users.length === 0) {
    text += 'Belum ada user.';
  } else {
    for (const u of users) {
      text += `• <code>${u.telegram_id}</code> ${escHtml(userMention(u))} — 💎${u.limit} | 📊${u.total_created} | ${escHtml(formatDate(u.created_at))}\n`;
    }
  }
  await ctx.reply(text, { reply_markup: adminBackKeyboard() });
}

export async function adminPending(ctx) {
  if (!adminGuard(ctx)) return;
  await ctx.answerCallbackQuery().catch(() => {});
  const pending = db.getPendingPayments(15);
  let text = '╭━━━━━━━━━━━━━━━━━━━━━━╮\n   💰 PENDING PAYMENT\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n';
  if (pending.length === 0) {
    text += 'Tidak ada payment pending. ✅';
  } else {
    for (const p of pending) {
      const type = p.payment_type === 'LIMIT' ? `+${p.add_limit} LIMIT` : `${p.account_username} (${p.role})`;
      text += `• <code>${p.payment_id}</code> [${p.status}] ${escHtml(type)} — ${escHtml(formatDateTime(p.created_at))}\n`;
    }
  }
  await ctx.reply(text, { reply_markup: adminBackKeyboard() });
}

export async function adminStats(ctx) {
  if (!adminGuard(ctx)) return;
  await ctx.answerCallbackQuery().catch(() => {});
  const s = getStats();
  const text = `╭━━━━━━━━━━━━━━━━━━━━━━╮
       📊 STATISTIK
╰━━━━━━━━━━━━━━━━━━━━━━╯

👥 Total User:
<code>${s.totalUsers}</code>

💰 Pending Payment:
<code>${s.pendingPayments}</code>

✅ Payment Success:
<code>${s.successPayments}</code>

❌ Payment Rejected:
<code>${s.rejectedPayments}</code>

⌛ Payment Expired:
<code>${s.expiredPayments}</code>

👤 Account Created:
<code>${s.totalAccounts}</code>

💎 Total Limit Used:
<code>${s.totalLimitUsed}</code>

💳 Limit Dibeli (sukses):
<code>${s.totalLimitPurchased}</code>`;
  await ctx.reply(text, { reply_markup: adminBackKeyboard() });
}

export async function adminLog(ctx) {
  if (!adminGuard(ctx)) return;
  await ctx.answerCallbackQuery().catch(() => {});
  const logs = db.getRecentAccountLogs(15);
  let text = '╭━━━━━━━━━━━━━━━━━━━━━━╮\n      📋 ACCOUNT LOG\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n';
  if (logs.length === 0) {
    text += 'Belum ada log akun.';
  } else {
    for (const l of logs) {
      text += `• <code>${l.api_username}</code> (${l.role}) [${l.payment_method}] — ${escHtml(formatDate(l.expires_at))}\n`;
    }
  }
  await ctx.reply(text, { reply_markup: adminBackKeyboard() });
}

export async function adminApiStatus(ctx) {
  if (!adminGuard(ctx)) return;
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.reply('🔌 Mengecek status BIRDSERVER...');
  const health = await checkApiHealth();
  const text = `╭━━━━━━━━━━━━━━━━━━━━━━╮
      🔌 API STATUS
╰━━━━━━━━━━━━━━━━━━━━━━╯

🌐 URL:
<code>${escHtml(health.url)}</code>

📡 Status:
<code>${health.ok ? `ONLINE (${health.status})` : `OFFLINE (${health.error || health.status})`}</code>

🤖 Bot: ${config.botName}
👑 Owner: <code>${config.ownerId}</code>`;
  await ctx.reply(text, { reply_markup: adminBackKeyboard() });
}

// ------------------------------------------------------------
// ➕ TAMBAH LIMIT (perintah /addlimit atau alur UI)
// ------------------------------------------------------------
export async function addLimitCommand(ctx) {
  const from = ctx.from;
  if (!from || !isAdminId(from.id)) {
    await ctx.reply('❌ Kamu tidak memiliki akses.');
    return;
  }
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  if (parts.length >= 3) {
    await performAddLimit(ctx, Number(parts[1]), Number(parts[2]));
    return;
  }
  setSession(from.id, { state: 'ADMIN_LIMIT_ID' });
  await ctx.reply('➕ TAMBAH LIMIT\n\nMasukkan <b>Telegram ID</b> user:');
}

async function performAddLimit(ctx, targetId, amount) {
  if (!Number.isInteger(targetId) || !Number.isInteger(amount) || amount <= 0 || amount > 100000) {
    await ctx.reply('❌ Format: /addlimit <telegram_id> <jumlah>\nContoh: /addlimit 123456789 10');
    return;
  }
  const result = addLimit(targetId, amount, { adminId: ctx.from.id });
  if (!result.ok) {
    await ctx.reply(`❌ User <code>${targetId}</code> tidak ditemukan di database. Minta user mengetik /start dulu.`);
    return;
  }
  await ctx.api.sendMessage(
    targetId,
    `🎁 LIMIT DITAMBAHKAN ADMIN\n\n💎 +${amount} LIMIT\n💎 Limit sekarang:\n<code>${result.newLimit}</code>`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
  await ctx.reply(`✅ Berhasil!\n\nUser: <code>${targetId}</code>\n💎 +${amount} LIMIT\n💎 Limit sekarang: <code>${result.newLimit}</code>`);
}

export async function handleAdminText(ctx) {
  const from = ctx.from;
  const session = getSession(from.id);
  if (!session || !['ADMIN_LIMIT_ID', 'ADMIN_LIMIT_AMOUNT'].includes(session.state)) return false;
  if (!isAdminId(from.id)) {
    clearSession(from.id);
    return true;
  }
  const text = (ctx.message.text || '').trim();

  if (session.state === 'ADMIN_LIMIT_ID') {
    if (!/^\d+$/.test(text)) {
      await ctx.reply('❌ Telegram ID harus berupa angka. Coba lagi:');
      return true;
    }
    session.adminTargetId = Number(text);
    session.state = 'ADMIN_LIMIT_AMOUNT';
    await ctx.reply(`Target: <code>${text}</code>\n\nMasukkan <b>jumlah limit</b> yang ditambahkan (angka):`);
    return true;
  }

  // ADMIN_LIMIT_AMOUNT
  const amount = Number(text);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
    await ctx.reply('❌ Jumlah tidak valid. Masukkan angka positif:');
    return true;
  }
  const targetId = session.adminTargetId;
  clearSession(from.id);
  const result = addLimit(targetId, amount, { adminId: from.id });
  if (!result.ok) {
    await ctx.reply(`❌ User <code>${targetId}</code> tidak ditemukan.`);
    return true;
  }
  await ctx.api.sendMessage(
    targetId,
    `🎁 LIMIT DITAMBAHKAN ADMIN\n\n💎 +${amount} LIMIT\n💎 Limit sekarang:\n<code>${result.newLimit}</code>`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
  await ctx.reply(`✅ Berhasil!\n\nUser: <code>${targetId}</code>\n💎 +${amount} LIMIT\n💎 Limit sekarang: <code>${result.newLimit}</code>`);
  return true;
}

export { adminMenu as adminMenuCallback };
