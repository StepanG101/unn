(function () {
  function qs(id) {
    return document.getElementById(id);
  }

  function show(el, text) {
    el.hidden = false;
    if (typeof text === "string") {
      el.textContent = text;
    }
  }

  function hide(el) {
    el.hidden = true;
  }

  function initReveal() {
    var nodes = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      nodes.forEach(function (node) {
        node.classList.add("is-visible");
      });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    nodes.forEach(function (node) {
      observer.observe(node);
    });
  }

  function formatCount(value) {
    return Math.round(value)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function initCounter() {
    var target = 12847;
    var node = qs("mission-count");
    var section = qs("mission");
    var started = false;

    function animate() {
      var start = null;
      var duration = 2000;
      function tick(ts) {
        if (!start) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = formatCount(target * eased);
        if (progress < 1) {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    }

    if (!("IntersectionObserver" in window)) {
      animate();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !started) {
            started = true;
            animate();
            observer.disconnect();
          }
        });
      },
      { threshold: 0.4 }
    );
    observer.observe(section);
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function (event) {
        var id = link.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function initModals() {
    document.querySelectorAll("[data-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dialog = qs("modal-" + btn.getAttribute("data-modal"));
        if (dialog && dialog.showModal) {
          dialog.showModal();
        }
      });
    });
    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dialog = btn.closest("dialog");
        if (dialog) dialog.close();
      });
    });
  }

  function initWeather() {
    var form = qs("weather-form");
    var cityInput = qs("city-input");
    var breedSelect = qs("breed-select");
    var errorNode = qs("weather-error");
    var loading = qs("weather-loading");
    var result = qs("weather-result");

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      hide(errorNode);
      hide(result);
      var city = cityInput.value.trim();
      if (!city) {
        show(errorNode, PetLifeWeather.messageForError("empty"));
        return;
      }
      show(loading);
      try {
        var data = await PetLifeWeather.fetchWeather(city);
        data.breedLabel = breedSelect.options[breedSelect.selectedIndex].text;
        result.innerHTML = PetLifeWeather.renderWeatherCard(data);
        show(result);
      } catch (err) {
        show(errorNode, PetLifeWeather.messageForError(err.message));
      } finally {
        hide(loading);
      }
    });
  }

  function initAI() {
    var pickBtn = qs("photo-pick-btn");
    var input = qs("photo-input");
    var preview = qs("photo-preview");
    var analyzeBtn = qs("analyze-btn");
    var errorNode = qs("photo-error");
    var loading = qs("ai-loading");
    var result = qs("ai-result");
    var dataUrl = "";

    pickBtn.addEventListener("click", function () {
      input.click();
    });

    input.addEventListener("change", async function () {
      hide(errorNode);
      hide(result);
      analyzeBtn.disabled = true;
      preview.hidden = true;
      dataUrl = "";
      var file = input.files && input.files[0];
      var validation = PetLifeAI.validateFile(file);
      if (validation) {
        show(errorNode, validation);
        return;
      }
      dataUrl = await PetLifeAI.fileToDataUrl(file);
      preview.src = dataUrl;
      preview.hidden = false;
      analyzeBtn.disabled = false;
    });

    analyzeBtn.addEventListener("click", async function () {
      if (!dataUrl) return;
      hide(errorNode);
      hide(result);
      show(loading);
      analyzeBtn.disabled = true;
      try {
        var text = await PetLifeAI.analyzePhoto(dataUrl);
        result.innerHTML = PetLifeAI.renderAiCard(text);
        show(result);
      } catch (err) {
        show(errorNode, err.message || "Что-то пошло не так. Попробуйте позже.");
      } finally {
        hide(loading);
        analyzeBtn.disabled = false;
      }
    });
  }

  function initForm() {
    var form = qs("access-form");
    var nameInput = qs("name-input");
    var emailInput = qs("email-input");
    var breedInput = qs("pet-breed-input");
    var nameError = qs("name-error");
    var emailError = qs("email-error");
    var success = qs("form-success");

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var nameMsg = PetLifeForm.validateName(nameInput.value);
      var emailMsg = PetLifeForm.validateEmail(emailInput.value);
      nameInput.classList.toggle("is-invalid", Boolean(nameMsg));
      emailInput.classList.toggle("is-invalid", Boolean(emailMsg));
      if (nameMsg) {
        show(nameError, nameMsg);
      } else {
        hide(nameError);
      }
      if (emailMsg) {
        show(emailError, emailMsg);
      } else {
        hide(emailError);
      }
      if (nameMsg || emailMsg) return;

      PetLifeForm.submitAccess(nameInput.value, emailInput.value, breedInput.value)
        .catch(function () {
          return null;
        })
        .finally(function () {
          success.textContent = PetLifeForm.successMessage(
            nameInput.value,
            emailInput.value,
            breedInput.value
          );
          form.hidden = true;
          show(success);
        });
    });
  }

  initReveal();
  initCounter();
  initSmoothScroll();
  initModals();
  initWeather();
  initAI();
  initForm();
})();
