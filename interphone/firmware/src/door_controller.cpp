#include "door_controller.h"

namespace door {

Controller::Controller(const Config& cfg) : cfg_(cfg) {}

void Controller::begin(uint32_t now_ms) {
  state_ = State::Offline;  // until setOnline(true); button still works here
  state_since_ = now_ms;
  btn_changed_at_ = now_ms;
}

void Controller::setButtonRaw(bool pressed, uint32_t now_ms) {
  if (pressed != btn_raw_) {
    btn_raw_ = pressed;
    btn_changed_at_ = now_ms;
  }
  // Debounce: raw level must hold for debounce_ms before it becomes the stable level.
  if (btn_raw_ != btn_stable_ && (now_ms - btn_changed_at_) >= cfg_.debounce_ms) {
    btn_stable_ = btn_raw_;
    if (btn_stable_) btn_press_event_ = true;  // rising edge of the debounced signal
  }
}

void Controller::setOnline(bool online) { online_ = online; }
void Controller::requestUnlock() { unlock_req_ = true; }
void Controller::requestDeny() { deny_req_ = true; }

void Controller::enter(State s, uint32_t now_ms) {
  state_ = s;
  state_since_ = now_ms;
  switch (s) {
    case State::LocalRing: pending_sound_ = Sound::Ring; break;
    case State::Unlocking: pending_sound_ = Sound::Unlocked; ++unlock_count_; break;
    default: break;
  }
}

bool Controller::blink(uint32_t now_ms, uint32_t period_ms) const {
  return ((now_ms - state_since_) / (period_ms / 2)) % 2 == 0;
}

Outputs Controller::tick(uint32_t now_ms) {
  const bool press = btn_press_event_;
  const bool unlock = unlock_req_;
  const bool deny = deny_req_;
  btn_press_event_ = unlock_req_ = deny_req_ = false;

  const uint32_t elapsed = now_ms - state_since_;

  switch (state_) {
    case State::Offline:
      if (online_) { enter(State::Idle, now_ms); break; }
      if (press) { enter(State::LocalRing, now_ms); break; }
      if (unlock) enter(State::Unlocking, now_ms);  // harmless; lets tests/serial drive it
      break;

    case State::Idle:
      if (!online_) { enter(State::Offline, now_ms); break; }
      if (unlock) { enter(State::Unlocking, now_ms); break; }
      if (press) { enter(State::LocalRing, now_ms); break; }
      if (deny) pending_sound_ = Sound::Denied;
      break;

    case State::LocalRing:
      if (unlock) { enter(State::Unlocking, now_ms); break; }
      if (deny) { pending_sound_ = Sound::Denied; enter(State::Idle, now_ms); break; }
      if (elapsed >= cfg_.local_ring_ms) {
        if (cfg_.local_ring_unlocks) enter(State::Unlocking, now_ms);
        else enter(online_ ? State::Idle : State::Offline, now_ms);
      }
      break;

    case State::Unlocking:
      if (unlock) ++rejected_unlocks_;
      if (elapsed >= cfg_.unlock_ms) enter(State::Cooldown, now_ms);
      break;

    case State::Cooldown:
      if (unlock) ++rejected_unlocks_;
      if (elapsed >= cfg_.cooldown_ms) enter(online_ ? State::Idle : State::Offline, now_ms);
      break;
  }

  Outputs out;
  out.relay = (state_ == State::Unlocking);
  switch (state_) {
    case State::Idle:      out.led = false; break;
    case State::LocalRing: out.led = blink(now_ms, 200); break;   // fast blink
    case State::Unlocking: out.led = true; break;                  // solid
    case State::Cooldown:  out.led = false; break;
    case State::Offline:   out.led = blink(now_ms, 2000); break;  // slow blink
  }
  out.sound = pending_sound_;
  pending_sound_ = Sound::None;
  return out;
}

const char* stateName(State s) {
  switch (s) {
    case State::Idle: return "IDLE";
    case State::LocalRing: return "LOCAL_RING";
    case State::Unlocking: return "UNLOCKING";
    case State::Cooldown: return "COOLDOWN";
    case State::Offline: return "OFFLINE";
  }
  return "?";
}

}  // namespace door
