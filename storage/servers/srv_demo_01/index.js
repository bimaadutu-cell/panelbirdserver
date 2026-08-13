console.log("==========================================");
console.log("  BIRDSERVER V1 - Developer by BimzOfficial");
console.log("==========================================");
console.log("Server srv_demo_01 initialized successfully!");
console.log("Timestamp:", new Date().toISOString());

setInterval(() => {
  console.log("[" + new Date().toISOString() + "] Heartbeat tick - Server active");
}, 10000);


process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const command = String(chunk).trim();
  if (!command) return;
  console.log(`[console] received command: ${command}`);
  if (command === "status") {
    console.log(`[status] uptime=${Math.floor(process.uptime())}s pid=${process.pid}`);
  } else if (command === "help") {
    console.log("Available commands: status, help, ping, echo <text>");
  } else if (command === "ping") {
    console.log("pong");
  } else if (command.startsWith("echo ")) {
    console.log(command.slice(5));
  }
});
