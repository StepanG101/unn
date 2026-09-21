(function (global) {
  var MAX_SIZE = 5 * 1024 * 1024;
  var PROMPT =
    "Ты — ветеринарный ассистент. Посмотри на фото питомца. Кратко опиши, что видишь. Если есть признаки проблем со здоровьем — укажи. Дай рекомендацию: наблюдать дома или обратиться к ветеринару. Отвечай на русском, дружелюбно, максимум 5 предложений.";

  function validateFile(file) {
    if (!file) {
      return "Загрузите изображение";
    }
    if (!file.type || file.type.indexOf("image/") !== 0) {
      return "Загрузите изображение";
    }
    if (file.size > MAX_SIZE) {
      return "Файл слишком большой (макс. 5 МБ)";
    }
    return "";
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("read"));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("Загрузите изображение"));
      };
      image.src = dataUrl;
    });
  }

  function inspectPixels(image) {
    var canvas = document.createElement("canvas");
    var width = 160;
    var height = Math.max(1, Math.round((image.height / Math.max(image.width, 1)) * width));
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    var pixels = ctx.getImageData(0, 0, width, height).data;

    var count = width * height;
    var sumR = 0;
    var sumG = 0;
    var sumB = 0;
    var redish = 0;
    var yellowish = 0;
    var dark = 0;
    var bright = 0;

    for (var i = 0; i < pixels.length; i += 4) {
      var r = pixels[i];
      var g = pixels[i + 1];
      var b = pixels[i + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      var luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < 40) dark += 1;
      if (luma > 210) bright += 1;
      if (r > 130 && r > g * 1.2 && r > b * 1.15) redish += 1;
      if (r > 140 && g > 130 && b < 110 && r + g > b * 2.2) yellowish += 1;
    }

    return {
      avgR: sumR / count,
      avgG: sumG / count,
      avgB: sumB / count,
      redShare: redish / count,
      yellowShare: yellowish / count,
      darkShare: dark / count,
      brightShare: bright / count,
      luma: (0.299 * sumR + 0.587 * sumG + 0.114 * sumB) / count
    };
  }

  function localAnalysisText(stats) {
    var notes = [];
    var watchHome = true;

    if (stats.redShare > 0.12) {
      notes.push("На снимке заметны красноватые участки — так могут выглядеть раздражение кожи, расчёсы или воспаление.");
      watchHome = false;
    }
    if (stats.yellowShare > 0.1) {
      notes.push("Есть желтоватые зоны: иногда так выглядят выделения из глаз или ушей, либо налёт на шёрстке.");
    }
    if (stats.darkShare > 0.28 && stats.luma < 90) {
      notes.push("Кадр довольно тёмный, часть деталей плохо видна, поэтому мелкие симптомы можно пропустить.");
    }
    if (stats.brightShare > 0.22) {
      notes.push("Сильная засветка могла скрыть цвет кожи и глаз — при сомнениях лучше переснять при дневном свете.");
    }
    if (!notes.length) {
      notes.push("По цвету и освещению явных тревожных пятен не видно: шёрстка и общий тон выглядят спокойно.");
    }

    var advice = watchHome
      ? "Пока можно наблюдать дома: следите за аппетитом, активностью и повторно сфотографируйте при хорошем свете."
      : "Есть повод насторожиться. Если покраснение, отёк или выделения не проходят за сутки — обратитесь к ветеринару.";

    return (
      "На фото питомец попал в кадр, я оценил освещение и цветовые зоны на снимке. " +
      notes.join(" ") +
      " " +
      advice +
      " Это предварительный разбор по изображению, а не диагноз."
    );
  }

  async function analyzeLocally(dataUrl) {
    var image = await loadImage(dataUrl);
    return localAnalysisText(inspectPixels(image));
  }

  async function analyzePhoto(dataUrl) {
    var response;
    try {
      response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, prompt: PROMPT })
      });
    } catch (err) {
      return analyzeLocally(dataUrl);
    }

    var payload = {};
    try {
      payload = await response.json();
    } catch (err) {
      return analyzeLocally(dataUrl);
    }

    if (payload && payload.text) {
      return payload.text;
    }
    if (payload && payload.source === "local") {
      return analyzeLocally(dataUrl);
    }
    if (response.status === 401) {
      throw new Error("Ошибка API-ключа. Проверьте ключ OpenRouter.");
    }
    if (response.status === 429) {
      throw new Error("Слишком много запросов. Подождите минуту.");
    }
    if (payload && payload.error && response.status >= 400 && payload.source !== "local") {
      throw new Error(payload.error);
    }
    return analyzeLocally(dataUrl);
  }

  function renderAiCard(text) {
    return (
      '<div class="ai-card">' +
      "<h4>🩺 Результат анализа</h4>" +
      "<p>" +
      text
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>") +
      "</p>" +
      '<p class="disclaimer">⚠️ Это не заменяет консультацию ветеринара. При серьёзных симптомах обратитесь к специалисту.</p>' +
      "</div>"
    );
  }

  global.PetLifeAI = {
    validateFile: validateFile,
    fileToDataUrl: fileToDataUrl,
    analyzePhoto: analyzePhoto,
    renderAiCard: renderAiCard
  };
})(window);
