// ============================================================
// bot.js — Entry point BIRDSERVER FREE TELEGRAM BOT
// Jalankan: npm start  (long polling, tanpa web server)
// ============================================================
import 'dotenv/config';
import { Bot } from 'grammy';
import { config, validateConfig, isAdminId } from './config.js';
import { initDatabase, closeDatabase } from './database.js';
import { logger } from './logger.js';
import { mainMenuKeyboard } from './keyboards.js';
import { startCommand, helpCommand, cancelCommand } from './handlers/start.js';
import { handleAdminText, addLimitCommand } from './handlers/admin.js';
import { handleProofPhoto, handleProofDocument } from './handlers/payment.js';
import { callbacksRouter } from './handlers/callbacks.js';
import { cleanupSessions, getSession } from './middleware.js';
import { handleCreateUsername } from './handlers/createAccount.js';
import { expireOldPayments } from './services/paymentService.js';

async function main() {
  const problems = validateConfig();
  if (problems.length > 0) {
    logger.error('config', `Konfigurasi tidak lengkap:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }

  initDatabase();

  const bot = new Bot(config.telegramBotToken);

  // --- Commands ---
  bot.command('start', startCommand);
  bot.command('help', helpCommand);
  bot.command('cancel', cancelCommand);
  bot.command('addlimit', addLimitCommand);

  // --- Text messages: hanya admin tools / fallback ---
  bot.on('message:text', async (ctx) => {
    // Saat flow CREATE meminta username, pesan teks user dipakai sebagai username.
    if (getSession(ctx.from?.id)?.state === 'CREATE_USERNAME') {
      if (await handleCreateUsername(ctx)) return;
    }
    if (await handleAdminText(ctx)) return;
    const from = ctx.from;
    await ctx.reply('ℹ️ Gunakan tombol menu di bawah ini 👇', {
      reply_markup: mainMenuKeyboard(from ? isAdminId(from.id) : false),
    });
  });

  // --- Bukti pembayaran (foto / dokumen gambar) ---
  bot.on('message:photo', handleProofPhoto);
  bot.on('message:document', handleProofDocument);

  // --- Inline keyboards ---
  // PENTING: 'callback_query:data' menangkap SEMUA tombol inline.
  // Jangan gunakan bot.callbackQuery('data', ...) — string tsb adalah
  // exact-match trigger, sehingga hanya tombol ber-payload 'data' yang jalan.
  bot.on('callback_query:data', callbacksRouter);

  // --- Global error handler (bot tidak boleh crash) ---
  bot.catch((err) => {
    logger.error('bot', `unhandled error: ${err.error?.message || err.message}`);
    try {
      if (err.ctx?.reply) {
        err.ctx.reply('⚠️ Terjadi kesalahan sementara.\nSilakan coba kembali.').catch(() => {});
      }
    } catch { /* ignore */ }
  });

  // --- Periodic tasks ---
  const sessionCleaner = setInterval(cleanupSessions, 60_000);

  const paymentExpirer = setInterval(async () => {
    try {
      const expired = expireOldPayments();
      for (const p of expired) {
        try {
          await bot.api.sendMessage(
            p.telegram_id,
            `⌛ PEMBAYARAN KADALUARSA\n\nOrder:\n<code>${p.payment_id}</code>\n\nSilakan membuat transaksi baru.`,
            { parse_mode: 'HTML' },
          );
        } catch { /* ignore */ }
      }
    } catch (err) {
      logger.error('bot', `payment expirer error: ${err.message}`);
    }
  }, 60_000);

  // --- Graceful shutdown ---
  const shutdown = async (signal) => {
    logger.info('bot', `${signal} diterima, mematikan bot...`);
    clearInterval(sessionCleaner);
    clearInterval(paymentExpirer);
    try { await bot.stop(); } catch { /* ignore */ }
    closeDatabase();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // --- Daftarkan command di Telegram (opsional, tidak fatal jika gagal) ---
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Mulai bot & menu utama' },
      { command: 'help', description: 'Bantuan penggunaan' },
      { command: 'cancel', description: 'Batalkan sesi berjalan' },
      { command: 'addlimit', description: '[ADMIN] Tambah limit user' },
    ]);
  } catch { /* ignore */ }

  logger.info('bot', `${config.botName} bot starting...`);
  await bot.start({
    onStart: (botInfo) => logger.info('bot', `@{${botInfo.username}} online!`),
  });
}

main().catch((err) => {
  logger.error('bot', `fatal: ${err.message}`);
  process.exit(1);
});
