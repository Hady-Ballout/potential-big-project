// Door controller state machine. Pure C++: no Arduino, no timers, no pins.
// main.cpp feeds it inputs + the current millis() and applies the Outputs it returns.
// This is what the native unit tests exercise.
#pragma once
#include <stdint.h>

namespace door {

enum class State : uint8_t { Idle, LocalRing, Unlocking, Cooldown, Offline };

// One-shot sound cues. Returned once on the tick where the transition happened.
enum class Sound : uint8_t { None, Ring, Unlocked, Denied, Error };

struct Config {
  uint32_t debounce_ms = 30;
  uint32_t unlock_ms = 3000;
  uint32_t cooldown_ms = 1000;
  uint32_t local_ring_ms = 1000;
  bool local_ring_unlocks = true;  // bench demo: button unlocks. product: false
};

struct Outputs {
  bool relay = false;
  bool led = false;
  Sound sound = Sound::None;
};

class Controller {
 public:
  explicit Controller(const Config& cfg = Config{});

  void begin(uint32_t now_ms);

  // Inputs. Call any of these before tick() in each loop iteration.
  void setButtonRaw(bool pressed, uint32_t now_ms);  // raw pin level, debounced here
  void setOnline(bool online);                        // Wi-Fi/backend reachable
  void requestUnlock();                               // cloud command (or test)
  void requestDeny();                                 // cloud command: resident denied

  Outputs tick(uint32_t now_ms);

  State state() const { return state_; }
  bool buttonPressed() const { return btn_stable_; }
  bool online() const { return online_; }
  uint32_t rejectedUnlocks() const { return rejected_unlocks_; }
  uint32_t unlockCount() const { return unlock_count_; }

 private:
  void enter(State s, uint32_t now_ms);
  bool blink(uint32_t now_ms, uint32_t period_ms) const;

  Config cfg_;
  State state_ = State::Idle;
  uint32_t state_since_ = 0;

  bool btn_raw_ = false;
  bool btn_stable_ = false;
  uint32_t btn_changed_at_ = 0;
  bool btn_press_event_ = false;

  bool online_ = false;
  bool unlock_req_ = false;
  bool deny_req_ = false;
  Sound pending_sound_ = Sound::None;

  uint32_t rejected_unlocks_ = 0;
  uint32_t unlock_count_ = 0;
};

const char* stateName(State s);

}  // namespace door
