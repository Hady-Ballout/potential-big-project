#include "buzzer.h"

namespace door {

namespace {
using Step = Buzzer::Step;
// {on_ms, off_ms} pairs
const Step RING[]     = {{150, 100}, {150, 100}, {150, 300}};                  // ta-ta-taa
const Step UNLOCKED[] = {{80, 60}, {80, 60}, {300, 0}};                        // two short + long
const Step DENIED[]   = {{500, 0}};                                            // one long
const Step ERROR_[]   = {{60, 60}, {60, 60}, {60, 60}, {60, 60}, {60, 0}};     // stutter
}  // namespace

void Buzzer::play(Sound s, uint32_t now_ms) {
  switch (s) {
    case Sound::Ring:     steps_ = RING;     count_ = 3; break;
    case Sound::Unlocked: steps_ = UNLOCKED; count_ = 3; break;
    case Sound::Denied:   steps_ = DENIED;   count_ = 1; break;
    case Sound::Error:    steps_ = ERROR_;   count_ = 5; break;
    case Sound::None:     steps_ = nullptr;  count_ = 0; return;
  }
  index_ = 0;
  step_started_ = now_ms;
}

bool Buzzer::tick(uint32_t now_ms) {
  if (!steps_) return false;
  const Step& st = steps_[index_];
  const uint32_t t = now_ms - step_started_;
  if (t < st.on_ms) return true;
  if (t < (uint32_t)st.on_ms + st.off_ms) return false;
  ++index_;
  step_started_ = now_ms;
  if (index_ >= count_) { steps_ = nullptr; return false; }
  return steps_[index_].on_ms > 0;
}

}  // namespace door
