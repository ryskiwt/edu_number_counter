const numberDisplay = document.querySelector("#numberDisplay");
const autoButton = document.querySelector("#autoButton");
const speechToggle = document.querySelector("#speechToggle");
const speechState = document.querySelector("#speechState");
const speechRateInputs = document.querySelectorAll(".speech-rate-input");
const readingChoiceInputs = document.querySelectorAll(".reading-choice-input");

const AUTO_BREATH_DELAY_MS = 700;
const AUTO_FALLBACK_DELAY_MS = 1800;
const READING_PREF_STORAGE_KEY = "numberCounterReadingPreferences";
const SPEECH_RATE_STORAGE_KEY = "numberCounterSpeechRate";
const speechRateValues = [...speechRateInputs]
  .map((input) => Number(input.value))
  .filter(Number.isFinite);
const DEFAULT_SPEECH_RATE = speechRateValues[0] ?? 0.8;
const MIN_COUNT = 0n;
const MAX_COUNT = 9999999999999999n;

let currentNumber = 0n;
let autoTimerId = null;
let isAutoRunning = false;
let isSpeechEnabled = false;
let japaneseVoice = null;
let speechRunId = 0;
let speechRate = DEFAULT_SPEECH_RATE;
let resizeFrameId = null;

const baseOnesReadings = [
  "",
  "いち",
  "に",
  "さん",
  "よん",
  "ご",
  "ろく",
  "なな",
  "はち",
  "きゅう",
];

const readingChoices = {
  0: ["ぜろ", "れい"],
  4: ["よん", "し"],
  7: ["なな", "しち"],
  9: ["きゅう", "く"],
};
const readingPreferenceIndexes = Object.fromEntries(
  Object.keys(readingChoices).map((key) => [key, 0]),
);
const largeUnitReadings = ["", "まん", "おく", "ちょう"];
const kanjiDigits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const kanjiPlaceUnits = ["", "十", "百", "千"];
const kanjiLargeUnits = ["", "万", "億", "兆"];

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function loadJapaneseVoice() {
  if (!canSpeak()) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();

  japaneseVoice =
    voices.find((voice) => voice.lang.toLowerCase() === "ja-jp") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) ??
    null;
}

function normalizeReadingPreferenceIndex(value) {
  return value === 1 ? 1 : 0;
}

function getReadingPreferenceIndex(key) {
  return normalizeReadingPreferenceIndex(readingPreferenceIndexes[key]);
}

function getReadingChoice(key) {
  const choices = readingChoices[key];

  return choices[getReadingPreferenceIndex(key)];
}

function getOnesReading(digit) {
  if (readingChoices[digit]) {
    return getReadingChoice(digit);
  }

  return baseOnesReadings[digit];
}

function getZeroReading() {
  return getReadingChoice(0);
}

function readStorageItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function loadReadingPreferences() {
  try {
    const savedPreferences = JSON.parse(
      readStorageItem(READING_PREF_STORAGE_KEY) ?? "{}",
    );

    Object.keys(readingPreferenceIndexes).forEach((key) => {
      readingPreferenceIndexes[key] = normalizeReadingPreferenceIndex(
        Number(savedPreferences[key]),
      );
    });
  } catch {
    Object.keys(readingPreferenceIndexes).forEach((key) => {
      readingPreferenceIndexes[key] = 0;
    });
  }
}

function saveReadingPreferences() {
  writeStorageItem(
    READING_PREF_STORAGE_KEY,
    JSON.stringify(readingPreferenceIndexes),
  );
}

function syncReadingChoiceInputs() {
  readingChoiceInputs.forEach((input) => {
    input.checked = getReadingPreferenceIndex(input.dataset.readingKey) === 1;
  });
}

function normalizeSpeechRate(value) {
  if (!Number.isFinite(value) || speechRateValues.length === 0) {
    return DEFAULT_SPEECH_RATE;
  }

  return speechRateValues.reduce((closestRate, rate) => {
    const closestDistance = Math.abs(closestRate - value);
    const optionDistance = Math.abs(rate - value);

    return optionDistance < closestDistance ? rate : closestRate;
  });
}

function syncSpeechRateInputs() {
  speechRateInputs.forEach((input) => {
    input.checked = Number(input.value) === speechRate;
  });
}

function loadSpeechRate() {
  try {
    const savedSpeechRate = readStorageItem(SPEECH_RATE_STORAGE_KEY);

    speechRate =
      savedSpeechRate === null
        ? DEFAULT_SPEECH_RATE
        : normalizeSpeechRate(Number(savedSpeechRate));
  } catch {
    speechRate = DEFAULT_SPEECH_RATE;
  }

  syncSpeechRateInputs();
}

function saveSpeechRate() {
  writeStorageItem(SPEECH_RATE_STORAGE_KEY, String(speechRate));
}

function getNumberDigitCount(value) {
  return String(value).length;
}

function clampCount(value) {
  if (value < MIN_COUNT) {
    return MIN_COUNT;
  }

  if (value > MAX_COUNT) {
    return MAX_COUNT;
  }

  return value;
}

function getPlaceReadingParts(digit, place) {
  if (digit === 0) {
    return { count: "", unit: "" };
  }

  if (place === 1) {
    return { count: getOnesReading(digit), unit: "" };
  }

  if (place === 10) {
    if (digit === 1) {
      return { count: "", unit: "じゅう" };
    }

    return { count: getOnesReading(digit), unit: "じゅう" };
  }

  if (place === 100) {
    const hundredReadings = {
      1: { count: "", unit: "ひゃく" },
      3: { count: "さん", unit: "びゃく" },
      6: { count: "ろっ", unit: "ぴゃく" },
      8: { count: "はっ", unit: "ぴゃく" },
    };

    return hundredReadings[digit] ?? { count: getOnesReading(digit), unit: "ひゃく" };
  }

  if (place === 1000) {
    const thousandReadings = {
      1: { count: "", unit: "せん" },
      3: { count: "さん", unit: "ぜん" },
      8: { count: "はっ", unit: "せん" },
    };

    return thousandReadings[digit] ?? { count: getOnesReading(digit), unit: "せん" };
  }

  return { count: getOnesReading(digit), unit: "" };
}

function getReadingText(readingParts) {
  return [readingParts.count, readingParts.unit]
    .filter(Boolean)
    .join("");
}

function buildDigits(value) {
  const numberText = String(value);
  const groups = [];

  for (let end = numberText.length; end > 0; end -= 4) {
    groups.unshift(numberText.slice(Math.max(0, end - 4), end));
  }

  let digitOffset = 0;

  const parts = groups.flatMap((group, groupIndex) => {
    const unitIndex = groups.length - groupIndex - 1;
    const unitReading = largeUnitReadings[unitIndex] ?? "";
    const digits = group.split("").map(Number);
    const shouldShowLargeUnit = Boolean(unitReading && Number(group) > 0);
    const maxPlace = 10 ** (digits.length - 1);
    const groupStartIndex = digitOffset;

    digitOffset += group.length;

    return digits.map((digit, index) => {
      const place = maxPlace / 10 ** index;
      const globalIndex = groupStartIndex + index;
      const readingParts = getPlaceReadingParts(digit, place);

      return {
        digit: String(digit),
        readingParts,
        readingText: getReadingText(readingParts),
        placeValue: 10n ** BigInt(numberText.length - globalIndex - 1),
        largeUnitAfter: shouldShowLargeUnit && index === digits.length - 1 ? unitReading : "",
      };
    });
  });

  if (value === 0n) {
    const zeroReading = getZeroReading();

    parts[parts.length - 1].readingParts = { count: zeroReading, unit: "" };
    parts[parts.length - 1].readingText = zeroReading;
  }

  return parts;
}

function getGroupSpeechText(groupText) {
  return groupText
    .split("")
    .map((digitText, index) => {
      const digit = Number(digitText);
      const place = groupText.length - index - 1;

      if (digit === 0) {
        return "";
      }

      if (digit === 1 && place > 0) {
        return kanjiPlaceUnits[place];
      }

      const digitSpeechText = readingChoices[digit]
        ? getReadingChoice(digit)
        : kanjiDigits[digit];

      return `${digitSpeechText}${kanjiPlaceUnits[place]}`;
    })
    .join("");
}

function getCurrentSpeechText() {
  if (currentNumber === 0n) {
    return getZeroReading();
  }

  const numberText = String(currentNumber);
  const groups = [];

  for (let end = numberText.length; end > 0; end -= 4) {
    groups.unshift(numberText.slice(Math.max(0, end - 4), end));
  }

  return groups
    .map((group, index) => {
      if (BigInt(group) === 0n) {
        return "";
      }

      const unitIndex = groups.length - index - 1;

      return `${getGroupSpeechText(group)}${kanjiLargeUnits[unitIndex]}`;
    })
    .filter(Boolean)
    .join("、");
}

function speakCurrentNumber(onDone) {
  if (!isSpeechEnabled || !canSpeak()) {
    return false;
  }

  loadJapaneseVoice();
  speechRunId += 1;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(getCurrentSpeechText());
  const activeSpeechRunId = speechRunId;

  utterance.lang = "ja-JP";
  utterance.rate = speechRate;
  utterance.pitch = 1.08;
  utterance.onend = () => {
    if (activeSpeechRunId === speechRunId) {
      onDone?.();
    }
  };
  utterance.onerror = () => {
    if (activeSpeechRunId === speechRunId) {
      onDone?.();
    }
  };

  if (japaneseVoice) {
    utterance.voice = japaneseVoice;
  }

  window.speechSynthesis.speak(utterance);
  return true;
}

function appendReadingParts(rt, readingParts) {
  const hasReading = readingParts.count || readingParts.unit;

  if (!hasReading) {
    rt.textContent = "・";
    return;
  }

  if (readingParts.count) {
    const count = document.createElement("span");

    count.className = "reading-count";
    count.textContent = readingParts.count;
    rt.append(count);
  }

  if (readingParts.unit) {
    const unit = document.createElement("span");

    unit.className = readingParts.count
      ? "reading-unit reading-place-unit"
      : "reading-count reading-place-unit";
    unit.textContent = readingParts.unit;
    rt.append(unit);
  }
}

function renderNumber() {
  const parts = buildDigits(currentNumber);
  const fragment = document.createDocumentFragment();
  const row = document.createElement("div");
  const trackShell = document.createElement("div");
  const countControls = document.createElement("div");
  const addDigitButton = document.createElement("button");
  const removeDigitButton = document.createElement("button");

  row.className = "number-row";
  trackShell.className = "number-track-shell";
  countControls.className = "digit-count-controls";

  addDigitButton.className = "digit-count-step";
  addDigitButton.type = "button";
  addDigitButton.dataset.digitAction = "add";
  addDigitButton.disabled =
    currentNumber + 10n ** BigInt(getNumberDigitCount(currentNumber)) > MAX_COUNT;
  addDigitButton.setAttribute("aria-label", "けたをふやす");
  addDigitButton.textContent = "◀ ふやす";

  removeDigitButton.className = "digit-count-step";
  removeDigitButton.type = "button";
  removeDigitButton.dataset.digitAction = "remove";
  removeDigitButton.disabled = currentNumber < 10n;
  removeDigitButton.setAttribute("aria-label", "けたをへらす");
  removeDigitButton.textContent = "へらす ▶";

  countControls.append(addDigitButton, removeDigitButton);
  fragment.append(countControls);

  parts.forEach((part) => {
    const column = document.createElement("div");
    const upButton = document.createElement("button");
    const ruby = document.createElement("ruby");
    const rt = document.createElement("rt");
    const downButton = document.createElement("button");

    column.className = "digit-column";

    upButton.className = "digit-step";
    upButton.type = "button";
    upButton.dataset.direction = "1";
    upButton.dataset.place = String(part.placeValue);
    upButton.disabled = currentNumber + part.placeValue > MAX_COUNT;
    upButton.title = "ふやす";
    upButton.setAttribute("aria-label", `${part.placeValue}の位をふやす`);
    upButton.textContent = "▲";

    downButton.className = "digit-step";
    downButton.type = "button";
    downButton.dataset.direction = "-1";
    downButton.dataset.place = String(part.placeValue);
    downButton.disabled = currentNumber < part.placeValue;
    downButton.title = "へらす";
    downButton.setAttribute("aria-label", `${part.placeValue}の位をへらす`);
    downButton.textContent = "▼";

    ruby.className = part.readingText ? "digit-ruby" : "digit-ruby empty-rt";
    ruby.append(part.digit);
    appendReadingParts(rt, part.readingParts);
    ruby.append(rt);

    column.append(upButton, ruby, downButton);
    row.append(column);

    if (part.largeUnitAfter) {
      const unitColumn = document.createElement("div");
      const unitLabel = document.createElement("span");

      unitColumn.className = "large-unit-column";
      unitLabel.className = "large-unit-label";
      unitLabel.textContent = part.largeUnitAfter;
      unitColumn.append(unitLabel);
      row.append(unitColumn);
    }
  });

  trackShell.append(row);
  fragment.append(trackShell);
  numberDisplay.replaceChildren(fragment);
  numberDisplay.setAttribute("aria-label", String(currentNumber));
  fitNumberRow(row, trackShell, countControls);
}

function fitNumberRow(row, trackShell, countControls) {
  numberDisplay.style.setProperty("--number-scale", "1");
  trackShell.style.width = "";

  if (!window.requestAnimationFrame) {
    return;
  }

  window.requestAnimationFrame(() => {
    const contentWidth = row.scrollWidth;
    const controlsWidth = countControls.offsetWidth || 0;
    const availableWidth = numberDisplay.clientWidth - controlsWidth - 18;

    if (!availableWidth || !contentWidth) {
      return;
    }

    const scale = Math.max(0.2, Math.min(1, availableWidth / contentWidth));

    numberDisplay.style.setProperty("--number-scale", scale.toFixed(3));
    trackShell.style.width = `${Math.ceil(contentWidth * scale)}px`;
  });
}

function scheduleNumberRefit() {
  if (!window.requestAnimationFrame) {
    renderNumber();
    return;
  }

  if (resizeFrameId !== null) {
    window.cancelAnimationFrame(resizeFrameId);
  }

  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = null;
    renderNumber();
  });
}

function setCurrentNumber(nextNumber) {
  const previousNumber = currentNumber;

  currentNumber = clampCount(nextNumber);
  renderNumber();

  if (currentNumber !== previousNumber) {
    handleNumberChanged();
  }
}

function handleNumberChanged() {
  const isAtMax = currentNumber >= MAX_COUNT;
  const didSpeak = speakCurrentNumber(() => {
    if (isAtMax) {
      stopAutoCount();
      return;
    }

    scheduleAutoCount(AUTO_BREATH_DELAY_MS);
  });

  if (isAutoRunning && !didSpeak) {
    if (isAtMax) {
      stopAutoCount();
      return;
    }

    scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
  }
}

function countNext() {
  setCurrentNumber(currentNumber + 1n);
}

function changePlaceValue(placeValue, direction) {
  const signedPlaceValue = direction > 0 ? placeValue : -placeValue;

  setCurrentNumber(currentNumber + signedPlaceValue);
}

function addDisplayDigit() {
  setCurrentNumber(currentNumber + 10n ** BigInt(getNumberDigitCount(currentNumber)));
}

function removeDisplayDigit() {
  const digitCount = getNumberDigitCount(currentNumber);

  if (digitCount <= 1) {
    return;
  }

  setCurrentNumber(currentNumber % 10n ** BigInt(digitCount - 1));
}

function stopAutoCount() {
  window.clearTimeout(autoTimerId);
  autoTimerId = null;
  isAutoRunning = false;
  autoButton.textContent = "スタート";
  autoButton.classList.remove("is-active");
  autoButton.setAttribute("aria-pressed", "false");
}

function startAutoCount() {
  if (currentNumber >= MAX_COUNT) {
    setCurrentNumber(MAX_COUNT);
    return;
  }

  isAutoRunning = true;
  autoButton.textContent = "ストップ";
  autoButton.classList.add("is-active");
  autoButton.setAttribute("aria-pressed", "true");

  const didSpeak = speakCurrentNumber(() => {
    scheduleAutoCount(AUTO_BREATH_DELAY_MS);
  });

  if (!didSpeak) {
    scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
  }
}

function scheduleAutoCount(delay) {
  if (!isAutoRunning) {
    return;
  }

  window.clearTimeout(autoTimerId);
  autoTimerId = window.setTimeout(() => {
    autoTimerId = null;

    if (isAutoRunning) {
      countNext();
    }
  }, delay);
}

function toggleAutoCount() {
  if (isAutoRunning) {
    stopAutoCount();
    return;
  }

  startAutoCount();
}

numberDisplay.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const countButton = event.target.closest(".digit-count-step");

  if (countButton) {
    if (countButton.dataset.digitAction === "add") {
      addDisplayDigit();
      return;
    }

    removeDisplayDigit();
    return;
  }

  const button = event.target.closest(".digit-step");

  if (!button) {
    return;
  }

  const placeValue = BigInt(button.dataset.place);
  const direction = Number(button.dataset.direction);

  changePlaceValue(placeValue, direction);
});

autoButton.addEventListener("click", toggleAutoCount);
speechToggle.addEventListener("change", () => {
  isSpeechEnabled = speechToggle.checked;
  speechState.textContent = isSpeechEnabled ? "ON" : "OFF";

  if (!isSpeechEnabled && canSpeak()) {
    speechRunId += 1;
    window.speechSynthesis.cancel();

    if (isAutoRunning) {
      scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
    }
  }

  if (isSpeechEnabled) {
    window.clearTimeout(autoTimerId);
    const didSpeak = speakCurrentNumber(() => {
      scheduleAutoCount(AUTO_BREATH_DELAY_MS);
    });

    if (isAutoRunning && !didSpeak) {
      scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
    }
  }
});

speechRateInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    speechRate = normalizeSpeechRate(Number(input.value));
    syncSpeechRateInputs();
    saveSpeechRate();
  });
});

readingChoiceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    readingPreferenceIndexes[input.dataset.readingKey] = input.checked ? 1 : 0;
    saveReadingPreferences();
    renderNumber();
  });
});

if (canSpeak()) {
  loadJapaneseVoice();
  window.speechSynthesis.addEventListener("voiceschanged", loadJapaneseVoice);
}

window.addEventListener("resize", scheduleNumberRefit);

loadReadingPreferences();
syncReadingChoiceInputs();
loadSpeechRate();
autoButton.setAttribute("aria-pressed", "false");
renderNumber();
