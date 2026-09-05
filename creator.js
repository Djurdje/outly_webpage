(() => {
  let currentStep = 1;

  function showStep(step) {
    document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
    const el = document.querySelector(`.step[data-step="${step}"]`);
    if (el) el.classList.add("active");
  }

  window.nextStep = function () {
    if (currentStep < 3) {
      currentStep++;
      showStep(currentStep);
    }
  };

  window.prevStep = function () {
    if (currentStep > 1) {
      currentStep--;
      showStep(currentStep);
    }
  };

  window.submitCreator = function () {
    const to = "outly.team@gmail.com";
    const subject = "New Creator Application";
    const body =
        "A new creator application has been submitted.\n\n" +
        "Please see attached documents.";

    const url =
        "https://mail.google.com/mail/?view=cm&fs=1" +
        "&to=" + encodeURIComponent(to) +
        "&su=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);

    window.open(url, "_blank");
  };



  // init
  document.addEventListener("DOMContentLoaded", () => showStep(currentStep));
})();
