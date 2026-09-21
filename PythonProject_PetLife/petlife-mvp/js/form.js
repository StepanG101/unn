(function (global) {
  function validateName(value) {
    if (!value || value.trim().length < 2) {
      return "Введите имя (минимум 2 символа)";
    }
    return "";
  }

  function validateEmail(value) {
    var email = (value || "").trim();
    if (email.indexOf("@") === -1 || email.indexOf(".") === -1) {
      return "Введите корректный email";
    }
    return "";
  }

  function successMessage(name, email, breed) {
    var pet = breed && breed.trim() ? breed.trim() : "любимец";
    return (
      "Спасибо, " +
      name.trim() +
      "! 🐾 Мы свяжемся с вами по адресу " +
      email.trim() +
      ". Ваш питомец (" +
      pet +
      ") получит бесплатный Premium на месяц при запуске!"
    );
  }

  async function submitAccess(name, email, breed) {
    var response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        breed: (breed || "").trim()
      })
    });
    if (!response.ok) {
      throw new Error("Что-то пошло не так. Попробуйте позже.");
    }
  }

  global.PetLifeForm = {
    validateName: validateName,
    validateEmail: validateEmail,
    successMessage: successMessage,
    submitAccess: submitAccess
  };
})(window);
