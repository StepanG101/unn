(function (global) {
  function calcAsphaltTemp(airTemp) {
    if (airTemp > 25) return airTemp + 20;
    if (airTemp >= 15) return airTemp + 10;
    if (airTemp >= 0) return airTemp + 5;
    return airTemp - 5;
  }

  function getRecommendation(airTemp, asphaltTemp) {
    if (asphaltTemp > 50) {
      return {
        level: "danger",
        text: "⚠️ Опасно! Гуляйте до 10:00 или после 20:00. Асфальт может обжечь лапы за секунды."
      };
    }
    if (asphaltTemp >= 40) {
      return {
        level: "warn",
        text: "⚠️ Осторожно. Сократите прогулку, избегайте асфальта, берите воду."
      };
    }
    if (airTemp < -10) {
      return {
        level: "danger",
        text: "⚠️ Опасно! Сократите прогулку до 10 минут. Мелким породам — тёплый комбинезон."
      };
    }
    if (airTemp < 0) {
      return {
        level: "warn",
        text: "❄️ Прохладно. Одевайте питомца, сократите прогулку."
      };
    }
    return {
      level: "ok",
      text: "✅ Отличное время для прогулки!"
    };
  }

  function buildResult(data) {
    var airTemp = Number(data.temp);
    var asphaltTemp = calcAsphaltTemp(airTemp);
    return {
      cityName: data.cityName,
      temp: airTemp,
      description: data.description,
      humidity: data.humidity,
      wind: Number(data.wind) || 0,
      feelsLike: Number(data.feelsLike),
      asphaltTemp: asphaltTemp,
      recommendation: getRecommendation(airTemp, asphaltTemp)
    };
  }

  async function fetchWeather(city) {
    var response;
    try {
      response = await fetch("/api/weather?city=" + encodeURIComponent(city));
    } catch (err) {
      throw new Error("network");
    }

    var payload = {};
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error("api");
    }

    if (response.status === 400 || payload.error === "empty") {
      throw new Error("empty");
    }
    if (response.status === 404 || payload.error === "not-found") {
      throw new Error("not-found");
    }
    if (!response.ok || payload.error) {
      throw new Error("api");
    }

    return buildResult(payload);
  }

  function renderWeatherCard(result) {
    var badgeClass =
      result.recommendation.level === "danger"
        ? "badge--danger"
        : result.recommendation.level === "warn"
          ? "badge--warn"
          : "badge--ok";

    return (
      '<div class="weather-card">' +
      "<h4>" +
      result.cityName +
      "</h4>" +
      (result.breedLabel ? "<p>Питомец: " + result.breedLabel + "</p>" : "") +
      '<div class="temp">' +
      Math.round(result.temp) +
      "°C</div>" +
      "<p>" +
      result.description +
      "</p>" +
      '<div class="meta">' +
      "<div>Влажность: " +
      result.humidity +
      "%</div>" +
      "<div>Ветер: " +
      result.wind.toFixed(1) +
      " м/с</div>" +
      "<div>Ощущается как: " +
      Math.round(result.feelsLike) +
      "°C</div>" +
      "<div>Температура асфальта: " +
      Math.round(result.asphaltTemp) +
      "°C</div>" +
      "</div>" +
      '<div class="badge ' +
      badgeClass +
      '">' +
      result.recommendation.text +
      "</div>" +
      "</div>"
    );
  }

  function messageForError(code) {
    if (code === "empty") return "Введите город";
    if (code === "not-found") return "Город не найден. Проверьте название.";
    if (code === "api-key") return "Ошибка API-ключа. Проверьте ключ OpenWeather.";
    return "Не удалось получить погоду. Попробуйте позже.";
  }

  global.PetLifeWeather = {
    fetchWeather: fetchWeather,
    renderWeatherCard: renderWeatherCard,
    messageForError: messageForError
  };
})(window);
