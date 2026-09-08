// Non-blocking buzzer pattern player for an ACTIVE buzzer (a HIGH level = sound).
// Pure C++: tick() returns the level main.cpp should write to the pin.
// If you end up with a PASSIVE buzzer, keep this class and replace digitalWrite
// with tone()/noTone() in main.cpp where the level is applied.
#pragma once
#include <stdint.h>
#include "door_controller.h"

namespace door {

class Buzzer {
 public:
  struct Step { uint16_t on_ms; uint16_t off_ms; };

  void play(Sound s, uint32_t now_ms);
  bool tick(uint32_t now_ms);          // returns desired output level
  bool playing() const { return steps_ != nullptr; }
  void stop() { steps_ = nullptr; }

 private:
  const Step* steps_ = nullptr;
  uint8_t count_ = 0;
  uint8_t index_ = 0;
  uint32_t step_started_ = 0;
};

}  // namespace door
