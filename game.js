(() => {
  "use strict";

  const canvas = document.querySelector("#canvas");
  const context = canvas.getContext("2d");
  const gameArea = document.querySelector("#game");
  const scoreElement = document.querySelector("#score");
  const hintElement = document.querySelector("#hint");
  const resultElement = document.querySelector("#result");
  const finalScoreElement = document.querySelector("#final-score");
  const restartButton = document.querySelector("#restart");
  const powerFill = document.querySelector("#power-fill");
  const powerState = document.querySelector("#power-state");

  const GRAVITY = 900;
  const MAX_CHARGE_MS = 1050;
  const PLAYER_RADIUS = 15;
  const PLATFORM_HEIGHT = 17;
  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    mode: "ready",
    score: 0,
    charge: 0,
    chargeStartedAt: 0,
    pointerId: null,
    generatedPlatforms: 0,
    cameraY: 0,
    targetCameraY: 0,
    lastTime: 0,
    currentPlatform: 0,
    platforms: [],
    particles: [],
    stars: [],
    player: null,
    audio: null,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function resizeCanvas() {
    const rect = gameArea.getBoundingClientRect();
    const oldWidth = state.width;
    state.width = Math.max(280, rect.width);
    state.height = Math.max(420, rect.height);
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    if (!state.stars.length || Math.abs(oldWidth - state.width) > 12) {
      createStars();
      resetGame();
    }
  }

  function createStars() {
    state.stars = Array.from({ length: Math.ceil((state.width * state.height) / 9000) }, () => ({
      x: Math.random() * state.width,
      y: Math.random() * state.height,
      radius: random(0.45, 1.55),
      alpha: random(0.22, 0.9),
      phase: Math.random() * Math.PI * 2,
      depth: random(0.05, 0.18),
    }));
  }

  function resetGame() {
    const startY = state.height * 0.68;
    const startWidth = Math.min(128, state.width * 0.34);
    state.mode = "ready";
    state.score = 0;
    state.charge = 0;
    state.chargeStartedAt = 0;
    state.pointerId = null;
    state.generatedPlatforms = 0;
    state.cameraY = 0;
    state.targetCameraY = 0;
    state.currentPlatform = 0;
    state.particles = [];
    state.platforms = [{
      x: state.width / 2 - startWidth / 2,
      y: startY,
      width: startWidth,
      seed: Math.random(),
    }];
    state.player = {
      x: state.width / 2,
      y: startY - PLAYER_RADIUS,
      vx: 0,
      vy: 0,
      rotation: 0,
      squash: 0,
    };
    ensurePlatforms();
    scoreElement.textContent = "0";
    finalScoreElement.textContent = "0";
    resultElement.hidden = true;
    hintElement.classList.remove("hide");
    updatePowerUI();
  }

  function generateNextPlatform(previous) {
    state.generatedPlatforms += 1;
    const difficulty = clamp((state.generatedPlatforms - 1) / 20, 0, 1);
    const width = random(lerp(105, 70, difficulty), lerp(132, 91, difficulty));
    const idealCharge = random(0.3, lerp(0.72, 0.86, difficulty));
    const verticalRise = random(42, lerp(88, 118, difficulty));
    const launchVy = -(365 + 205 * idealCharge);
    const launchVx = 110 + 110 * idealCharge;
    const discriminant = Math.max(0, launchVy * launchVy - 2 * GRAVITY * verticalRise);
    const flightTime = (-launchVy + Math.sqrt(discriminant)) / GRAVITY;
    const horizontalDistance = launchVx * flightTime;
    const previousCenter = previous.x + previous.width / 2;
    let direction = previousCenter < state.width / 2 ? 1 : -1;
    let center = previousCenter + direction * horizontalDistance;
    const margin = width / 2 + 18;

    if (center < margin || center > state.width - margin) {
      direction *= -1;
      center = previousCenter + direction * horizontalDistance;
    }

    center = clamp(center, margin, state.width - margin);
    return {
      x: center - width / 2,
      y: previous.y - verticalRise,
      width,
      seed: Math.random(),
    };
  }

  function ensurePlatforms() {
    while (state.platforms.length < state.currentPlatform + 5) {
      const previous = state.platforms[state.platforms.length - 1];
      state.platforms.push(generateNextPlatform(previous));
    }
  }

  function beginCharge(event) {
    if (state.mode !== "ready" || !resultElement.hidden) return;
    event.preventDefault();
    state.pointerId = event.pointerId;
    gameArea.setPointerCapture?.(event.pointerId);
    state.mode = "charging";
    state.chargeStartedAt = performance.now();
    state.charge = 0;
    hintElement.classList.add("hide");
    ensureAudio();
    updatePowerUI();
  }

  function releaseCharge(event) {
    if (state.mode !== "charging" || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    gameArea.releasePointerCapture?.(event.pointerId);
    state.pointerId = null;
    state.charge = clamp((performance.now() - state.chargeStartedAt) / MAX_CHARGE_MS, 0.08, 1);
    launchPlayer(state.charge);
  }

  function cancelCharge(event) {
    if (state.mode !== "charging" || event.pointerId !== state.pointerId) return;
    gameArea.releasePointerCapture?.(event.pointerId);
    state.pointerId = null;
    state.mode = "ready";
    state.charge = 0;
    state.player.squash = 0;
    updatePowerUI();
  }

  function launchPlayer(power) {
    const target = state.platforms[state.currentPlatform + 1];
    const targetCenter = target.x + target.width / 2;
    const direction = Math.sign(targetCenter - state.player.x) || 1;
    state.player.vx = direction * (110 + 110 * power);
    state.player.vy = -(365 + 205 * power);
    state.player.squash = 0;
    state.mode = "jumping";
    playTone(260 + power * 130, 0.07, "sine", 0.035);
    updatePowerUI();
  }

  function update(delta, time) {
    if (state.mode === "charging") {
      state.charge = clamp((time - state.chargeStartedAt) / MAX_CHARGE_MS, 0, 1);
      state.player.squash = lerp(state.player.squash, 0.28 + state.charge * 0.28, 0.16);
      updatePowerUI();
    } else if (state.mode === "jumping") {
      const previousY = state.player.y;
      state.player.vy += GRAVITY * delta;
      state.player.x += state.player.vx * delta;
      state.player.y += state.player.vy * delta;
      state.player.rotation += state.player.vx * delta * 0.008;

      const target = state.platforms[state.currentPlatform + 1];
      const previousBottom = previousY + PLAYER_RADIUS;
      const currentBottom = state.player.y + PLAYER_RADIUS;
      const crossedTop = state.player.vy > 0 && previousBottom <= target.y && currentBottom >= target.y;
      const insidePlatform = state.player.x + PLAYER_RADIUS * 0.42 >= target.x
        && state.player.x - PLAYER_RADIUS * 0.42 <= target.x + target.width;

      if (crossedTop && insidePlatform) {
        landOnPlatform(target);
      } else if (state.player.y - state.cameraY > state.height + 90) {
        endGame();
      }
    } else if (state.mode === "ready") {
      state.player.squash = lerp(state.player.squash, 0, 0.14);
    }

    const followLine = state.height * 0.46;
    if (state.player.y - state.cameraY < followLine) {
      state.targetCameraY = state.player.y - followLine;
    }
    state.cameraY = lerp(state.cameraY, state.targetCameraY, 1 - Math.pow(0.001, delta));

    updateParticles(delta);
  }

  function landOnPlatform(platform) {
    state.currentPlatform += 1;
    state.score += 1;
    state.mode = "ready";
    state.charge = 0;
    state.player.y = platform.y - PLAYER_RADIUS;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.rotation = 0;
    state.player.squash = 0.24;
    scoreElement.textContent = String(state.score);
    spawnLandingParticles(state.player.x, platform.y);
    playTone(520 + Math.min(state.score, 12) * 18, 0.08, "sine", 0.055);
    if (navigator.vibrate) navigator.vibrate(18);

    ensurePlatforms();
    const removable = Math.max(0, state.currentPlatform - 2);
    if (removable > 0) {
      state.platforms.splice(0, removable);
      state.currentPlatform -= removable;
    }
    updatePowerUI();
  }

  function endGame() {
    if (state.mode === "dead") return;
    state.mode = "dead";
    state.charge = 0;
    finalScoreElement.textContent = String(state.score);
    updatePowerUI();
    playTone(165, 0.22, "triangle", 0.06);
    if (navigator.vibrate) navigator.vibrate([35, 45, 70]);
    window.setTimeout(() => {
      resultElement.hidden = false;
      restartButton.focus({ preventScroll: true });
    }, 260);
  }

  function spawnLandingParticles(x, y) {
    for (let index = 0; index < 12; index += 1) {
      const angle = random(Math.PI * 1.08, Math.PI * 1.92);
      const speed = random(45, 135);
      state.particles.push({
        x,
        y: y - 3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: random(1.5, 3.5),
        warm: Math.random() > 0.45,
      });
    }
  }

  function updateParticles(delta) {
    state.particles.forEach((particle) => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += 190 * delta;
      particle.life -= delta * 1.9;
    });
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function updatePowerUI() {
    powerFill.style.width = `${state.charge * 100}%`;
    if (state.mode === "charging") {
      powerState.textContent = state.charge > 0.86 ? "满力" : "按住…";
    } else if (state.mode === "jumping") {
      powerState.textContent = "跃起";
    } else if (state.mode === "dead") {
      powerState.textContent = "结束";
    } else {
      powerState.textContent = "准备";
    }
  }

  function ensureAudio() {
    if (state.audio) {
      state.audio.resume?.();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) state.audio = new AudioContext();
  }

  function playTone(frequency, duration, type, volume) {
    if (!state.audio) return;
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    const now = state.audio.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(state.audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  function draw(time) {
    context.clearRect(0, 0, state.width, state.height);
    drawSky(time);
    drawPlatforms();
    drawParticles();
    drawPlayer(time);
  }

  function drawSky(time) {
    state.stars.forEach((star) => {
      const parallaxY = ((star.y - state.cameraY * star.depth) % state.height + state.height) % state.height;
      const twinkle = 0.65 + Math.sin(time * 0.0016 + star.phase) * 0.35;
      context.beginPath();
      context.arc(star.x, parallaxY, star.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 241, 190, ${star.alpha * twinkle})`;
      context.fill();
    });

    const moonX = state.width * 0.8;
    const moonY = state.height * 0.18 - state.cameraY * 0.04;
    const moonGlow = context.createRadialGradient(moonX, moonY, 2, moonX, moonY, 56);
    moonGlow.addColorStop(0, "rgba(255, 242, 191, 0.85)");
    moonGlow.addColorStop(0.22, "rgba(255, 229, 149, 0.22)");
    moonGlow.addColorStop(1, "rgba(255, 229, 149, 0)");
    context.fillStyle = moonGlow;
    context.fillRect(moonX - 60, moonY - 60, 120, 120);
    context.beginPath();
    context.arc(moonX, moonY, 10, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 244, 207, 0.92)";
    context.fill();
  }

  function drawPlatforms() {
    state.platforms.forEach((platform, index) => {
      const y = platform.y - state.cameraY;
      if (y < -80 || y > state.height + 80) return;

      const isTarget = index === state.currentPlatform + 1;
      context.save();
      context.shadowColor = isTarget ? "rgba(209, 173, 255, 0.42)" : "rgba(113, 78, 214, 0.22)";
      context.shadowBlur = isTarget ? 22 : 12;

      roundedRect(context, platform.x, y, platform.width, PLATFORM_HEIGHT, 9);
      const topGradient = context.createLinearGradient(platform.x, y, platform.x, y + PLATFORM_HEIGHT);
      topGradient.addColorStop(0, isTarget ? "#b898ff" : "#8f72e7");
      topGradient.addColorStop(1, "#4e378f");
      context.fillStyle = topGradient;
      context.fill();
      context.shadowBlur = 0;

      context.beginPath();
      context.moveTo(platform.x + 8, y + PLATFORM_HEIGHT - 2);
      context.lineTo(platform.x + platform.width * 0.24, y + PLATFORM_HEIGHT + 20 + platform.seed * 15);
      context.lineTo(platform.x + platform.width * 0.48, y + PLATFORM_HEIGHT + 9);
      context.lineTo(platform.x + platform.width * 0.68, y + PLATFORM_HEIGHT + 27 - platform.seed * 9);
      context.lineTo(platform.x + platform.width - 8, y + PLATFORM_HEIGHT - 2);
      context.closePath();
      const rockGradient = context.createLinearGradient(platform.x, y, platform.x, y + 45);
      rockGradient.addColorStop(0, "#49337f");
      rockGradient.addColorStop(1, "rgba(30, 22, 66, 0.18)");
      context.fillStyle = rockGradient;
      context.fill();

      context.beginPath();
      context.moveTo(platform.x + platform.width * 0.18, y + 2);
      context.lineTo(platform.x + platform.width * 0.2, y - 6 - platform.seed * 5);
      context.lineTo(platform.x + platform.width * 0.24, y + 2);
      context.fillStyle = "rgba(235, 213, 255, 0.62)";
      context.fill();
      context.restore();
    });
  }

  function drawPlayer(time) {
    const player = state.player;
    const y = player.y - state.cameraY;
    const pulse = 1 + Math.sin(time * 0.005) * 0.025;
    const scaleX = pulse * (1 + player.squash * 0.46);
    const scaleY = pulse * (1 - player.squash * 0.36);
    const glowStrength = state.mode === "charging" ? 0.36 + state.charge * 0.58 : 0.32;

    context.save();
    context.translate(player.x, y);
    context.rotate(player.rotation);
    context.scale(scaleX, scaleY);

    const glow = context.createRadialGradient(0, 0, 3, 0, 0, 35);
    glow.addColorStop(0, `rgba(255, 240, 161, ${glowStrength})`);
    glow.addColorStop(0.35, `rgba(255, 211, 103, ${glowStrength * 0.35})`);
    glow.addColorStop(1, "rgba(255, 211, 103, 0)");
    context.fillStyle = glow;
    context.fillRect(-38, -38, 76, 76);

    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = point % 2 === 0 ? PLAYER_RADIUS : PLAYER_RADIUS * 0.58;
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const x = Math.cos(angle) * radius;
      const starY = Math.sin(angle) * radius;
      if (point === 0) context.moveTo(x, starY);
      else context.lineTo(x, starY);
    }
    context.closePath();
    const bodyGradient = context.createRadialGradient(-4, -6, 1, 0, 0, PLAYER_RADIUS * 1.3);
    bodyGradient.addColorStop(0, "#fffce5");
    bodyGradient.addColorStop(0.36, "#ffe99e");
    bodyGradient.addColorStop(1, "#ffba4d");
    context.fillStyle = bodyGradient;
    context.fill();

    context.fillStyle = "#4b3a66";
    context.beginPath();
    context.arc(-4.5, -1, 1.45, 0, Math.PI * 2);
    context.arc(4.5, -1, 1.45, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(0, 3, 3.2, 0.15, Math.PI - 0.15);
    context.strokeStyle = "rgba(75, 58, 102, 0.7)";
    context.lineWidth = 1.1;
    context.stroke();
    context.restore();
  }

  function drawParticles() {
    state.particles.forEach((particle) => {
      context.globalAlpha = clamp(particle.life, 0, 1);
      context.fillStyle = particle.warm ? "#ffe494" : "#c9a8ff";
      context.beginPath();
      context.arc(particle.x, particle.y - state.cameraY, particle.size, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
  }

  function frame(time) {
    const delta = Math.min((time - state.lastTime) / 1000 || 0, 0.033);
    state.lastTime = time;
    update(delta, time);
    draw(time);
    requestAnimationFrame(frame);
  }

  gameArea.addEventListener("pointerdown", beginCharge);
  gameArea.addEventListener("pointerup", releaseCharge);
  gameArea.addEventListener("pointercancel", cancelCharge);
  gameArea.addEventListener("contextmenu", (event) => event.preventDefault());
  restartButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  restartButton.addEventListener("pointerup", (event) => event.stopPropagation());
  restartButton.addEventListener("click", resetGame);
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "charging") {
      state.mode = "ready";
      state.charge = 0;
      state.player.squash = 0;
      updatePowerUI();
    }
  });

  resizeCanvas();
  requestAnimationFrame(frame);
})();
