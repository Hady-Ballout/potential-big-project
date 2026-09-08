// Interphone door controller — wiring only. Logic lives in door_controller / buzzer,
// networking in net_client. See README.md for the serial test commands.
#include <Arduino.h>
#include "pins.h"
#include "config.h"
#include "door_controller.h"
#include "buzzer.h"
#include "net_client.h"

static door::Controller ctl([] {
  door::Config c;
  c.debounce_ms = DEBOUNCE_MS;
  c.unlock_ms = UNLOCK_MS;
  c.cooldown_ms = COOLDOWN_MS;
  c.local_ring_ms = LOCAL_RING_MS;
  c.local_ring_unlocks = LOCAL_RING_UNLOCKS != 0;
  return c;
}());
static door::Buzzer buzzer;
static NetClient net;
static door::State last_state = door::State::Offline;  // so the first transition (-> IDLE) is logged

static void printStatus() {
  Serial.printf("[door] state=%s online=%d wifi=%d unlocks=%lu rejected=%lu err=\"%s\"\n",
                door::stateName(ctl.state()), net.online(), net.wifiConnected(),
                (unsigned long)ctl.unlockCount(), (unsigned long)ctl.rejectedUnlocks(),
                net.lastError());
}

static void handleSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    switch (ch) {
      case 'u': Serial.println("[serial] unlock"); ctl.requestUnlock(); break;
      case 'd': Serial.println("[serial] deny");   ctl.requestDeny();   break;
      case 's': printStatus(); break;
      case 'h': case '?':
        Serial.println("keys: u=unlock  d=deny  s=status  (press the button for a local ring)");
        break;
      default: break;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\nInterphone door controller v%s on %s\n", INTERPHONE_VERSION, BOARD_NAME);
  Serial.printf("pins: relay=%d led=%d buzzer=%d button=%d\n", PIN_RELAY, PIN_LED, PIN_BUZZER, PIN_BUTTON);

  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);  // external 10k pull-up is also on the board; both is fine
  digitalWrite(PIN_RELAY, !RELAY_ACTIVE_LEVEL);
  digitalWrite(PIN_BUZZER, !BUZZER_ACTIVE_LEVEL);

  ctl.begin(millis());
  net.begin();
  Serial.println("keys: u=unlock  d=deny  s=status");
}

void loop() {
  const uint32_t now = millis();

  // inputs
  ctl.setButtonRaw(digitalRead(PIN_BUTTON) == BUTTON_PRESSED_LEVEL, now);
  handleSerial();
  ctl.setOnline(net.online());
  DeviceCommand cmd;
  while (net.nextCommand(cmd)) {
    Serial.printf("[net] command %s (%s)\n", cmd.action, cmd.id);
    if (strcmp(cmd.action, "unlock") == 0) ctl.requestUnlock();
    else if (strcmp(cmd.action, "deny") == 0) ctl.requestDeny();
  }

  // logic
  const door::Outputs out = ctl.tick(now);
  if (out.sound != door::Sound::None) buzzer.play(out.sound, now);

  // outputs
  digitalWrite(PIN_RELAY, out.relay ? RELAY_ACTIVE_LEVEL : !RELAY_ACTIVE_LEVEL);
  digitalWrite(PIN_LED, out.led ? HIGH : LOW);
  digitalWrite(PIN_BUZZER, buzzer.tick(now) ? BUZZER_ACTIVE_LEVEL : !BUZZER_ACTIVE_LEVEL);

  if (ctl.state() != last_state) {
    last_state = ctl.state();
    net.reportState(door::stateName(last_state));
    Serial.printf("[door] -> %s\n", door::stateName(last_state));
  }
  delay(1);
}
