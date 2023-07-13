// script.js

$(document).ready(function(){
  let lastKeypressTime = 0;
  let countdownTimer;
  let selectedTime = 1;  // Default time is 1 minute
  let started = false;   // Flag to check if timer is started
  let timerEnded = false; // Flag to check if the timer has ended
  const progressBar = $("#progress-bar");
  const typingArea = $("#typingArea");

  $("#fullscreenBtn").on("click", function() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen(); 
        }
    }
  });

  $(".form-check-input").on("change", function() {
      selectedTime = $(this).val();
      resetAll();
  });

  typingArea.on("keydown", function(event) {
      if(!timerEnded && event.keyCode !== 8) { //ignore backspace key & check timer ended
          typingArea.removeClass("fade-out");
          lastKeypressTime = Date.now();

          let keycode = event.keyCode;

          let valid = 
              (keycode > 47 && keycode < 58)   || // number keys
              keycode == 32 || keycode == 13   || // spacebar & return key(s) (if you want to allow carriage returns)
              (keycode > 64 && keycode < 91)   && // letter keys
              (keycode < 112 || keycode > 123) || // function keys
              (keycode > 95 && keycode < 112)  || // numpad keys
              (keycode > 185 && keycode < 193) || // ;=,-./` (in order)
              (keycode > 218 && keycode < 223);   // [\]' (in order)      
              
          const controlKeyCodes = [8, 9, 13, 16, 17, 18, 19, 20, 27, 33, 34, 35, 36, 37, 38, 39, 40, 45, 46];

          if (!started && valid && !controlKeyCodes.includes(keycode)) {
              startCountdown();
              started = true;
          }
      }
  });

   // Prevent pasting into text area
  typingArea.on("paste", function(event) {
    event.preventDefault();
  });

  $("#restart").on("click", function() {
      $("#overlay").hide();
      resetAll();
  });

  function startCountdown() {
      let oneMinute = 60;
      let timeLeft = selectedTime * oneMinute;
      let checkProgress = function() {
        $("#timer").html(`Time left: ${timeLeft} seconds`);
        progressBar.css('width', ((selectedTime * oneMinute - timeLeft) / (selectedTime * oneMinute) * 100) + '%');
        timeLeft--;

        if (Date.now() - lastKeypressTime >= 5000 && !timerEnded) {
            onStopTyping();
        } else if (!timerEnded && Date.now() - lastKeypressTime > 0) {
          typingArea.addClass("fade-out");
        } else if (timerEnded) {
            typingArea.removeClass("fade-out");
        }

        if (timeLeft < 0) {
            clearInterval(countdownTimer);
            $("#timer").html("Time's up!");
            timerEnded = true;
            typingArea.removeClass("fade-out");
        }
    }
    checkProgress();
    countdownTimer = setInterval(checkProgress, 1000);
  }

  function onStopTyping() {
      $("#overlay").show();
      resetAll();
  }

  function resetAll() {
      started = false;
      timerEnded = false;
      clearInterval(countdownTimer);
      countdownTimer = undefined;
      typingArea.removeClass("fade-out").html("");
      lastKeypressTime = 0;
      $("#wordCount").html("");
      $("#timer").html("");
      progressBar.css('width', '0%');
  }
  
  // Updating the word count whenever input changes
  typingArea.on('input', function() {
      let words = $(this).text().match(/\b[-?(\w+)?]+\b/gi);
      if(words) {
          $("#wordCount").html("Word Count: " + words.length);
      } else {
          $("#wordCount").html("Word Count: 0");
      }
  });
});

