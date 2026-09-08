// Native unit tests for the door state machine and buzzer. Run: pio test -e native
#include <unity.h>
#include "door_controller.h"
#include "buzzer.h"

using namespace door;

static Config cfg() {
  Config c;
  c.debounce_ms = 30;
  c.unlock_ms = 3000;
  c.cooldown_ms = 1000;
  c.local_ring_ms = 1000;
  c.local_ring_unlocks = true;
  return c;
}

// Runs the controller from t0 to t1 in 1 ms steps, returning the last outputs.
// Records how long the relay was high.
struct Run {
  Outputs last;
  uint32_t relay_ms = 0;
  Sound first_sound = Sound::None;
};
static Run advance(Controller& c, uint32_t& t, uint32_t until) {
  Run r;
  for (; t < until; ++t) {
    r.last = c.tick(t);
    if (r.last.relay) ++r.relay_ms;
    if (r.first_sound == Sound::None && r.last.sound != Sound::None) r.first_sound = r.last.sound;
  }
  return r;
}

static Controller onlineController(uint32_t& t) {
  Controller c(cfg());
  c.begin(t);
  c.setOnline(true);
  c.tick(t++);
  return c;
}

void setUp() {}
void tearDown() {}

void test_starts_offline_then_idle_when_online() {
  uint32_t t = 0;
  Controller c(cfg());
  c.begin(t);
  c.tick(t++);
  TEST_ASSERT_EQUAL(State::Offline, c.state());
  c.setOnline(true);
  c.tick(t++);
  TEST_ASSERT_EQUAL(State::Idle, c.state());
}

void test_unlock_pulses_relay_for_unlock_ms_then_cooldown() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  c.requestUnlock();
  Run r = advance(c, t, t + 3000);
  TEST_ASSERT_EQUAL(State::Unlocking, c.state());
  TEST_ASSERT_EQUAL(Sound::Unlocked, r.first_sound);
  TEST_ASSERT_TRUE(r.last.led);
  r = advance(c, t, t + 1);
  TEST_ASSERT_EQUAL(State::Cooldown, c.state());
  TEST_ASSERT_FALSE(r.last.relay);
  r = advance(c, t, t + 1000);
  TEST_ASSERT_EQUAL(State::Idle, c.state());
  TEST_ASSERT_EQUAL_UINT32(1, c.unlockCount());
}

void test_relay_high_time_is_exactly_unlock_ms() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  c.requestUnlock();
  Run r = advance(c, t, t + 6000);
  TEST_ASSERT_EQUAL_UINT32(3000, r.relay_ms);
}

void test_unlock_during_unlocking_or_cooldown_is_rejected() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  c.requestUnlock();
  advance(c, t, t + 100);
  c.requestUnlock();           // while Unlocking
  Run r = advance(c, t, t + 3000);
  TEST_ASSERT_EQUAL_UINT32(2900, r.relay_ms);  // remaining 2900 ms of the single pulse, no extension
  TEST_ASSERT_EQUAL(State::Cooldown, c.state());
  c.requestUnlock();           // while Cooldown
  r = advance(c, t, t + 2000);
  TEST_ASSERT_EQUAL_UINT32(0, r.relay_ms);
  TEST_ASSERT_EQUAL_UINT32(2, c.rejectedUnlocks());
  TEST_ASSERT_EQUAL_UINT32(1, c.unlockCount());
  TEST_ASSERT_EQUAL(State::Idle, c.state());
}

void test_button_is_debounced() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  // 10 ms glitch: must be ignored
  c.setButtonRaw(true, t); advance(c, t, t + 10);
  c.setButtonRaw(false, t); advance(c, t, t + 50);
  TEST_ASSERT_EQUAL(State::Idle, c.state());
  // Real press held 40 ms: accepted once debounce (30 ms) elapses
  for (int i = 0; i < 40; ++i) { c.setButtonRaw(true, t); c.tick(t++); }
  TEST_ASSERT_EQUAL(State::LocalRing, c.state());
  TEST_ASSERT_TRUE(c.buttonPressed());
}

void test_local_ring_then_unlocks_in_demo_mode() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  for (int i = 0; i < 40; ++i) { c.setButtonRaw(true, t); c.tick(t++); }
  Run r = advance(c, t, t + 1000);
  TEST_ASSERT_EQUAL(State::Unlocking, c.state());
  TEST_ASSERT_TRUE(r.last.relay);
}

void test_local_ring_returns_to_idle_when_demo_unlock_disabled() {
  uint32_t t = 0;
  Config k = cfg(); k.local_ring_unlocks = false;
  Controller c(k); c.begin(t); c.setOnline(true); c.tick(t++);
  for (int i = 0; i < 40; ++i) { c.setButtonRaw(true, t); c.tick(t++); }
  TEST_ASSERT_EQUAL(State::LocalRing, c.state());
  Run r = advance(c, t, t + 1001);
  TEST_ASSERT_EQUAL(State::Idle, c.state());
  TEST_ASSERT_EQUAL_UINT32(0, r.relay_ms);
}

void test_deny_during_local_ring_cancels_with_denied_sound() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  for (int i = 0; i < 40; ++i) { c.setButtonRaw(true, t); c.tick(t++); }
  c.requestDeny();
  Outputs o = c.tick(t++);
  TEST_ASSERT_EQUAL(State::Idle, c.state());
  TEST_ASSERT_EQUAL(Sound::Denied, o.sound);
}

void test_offline_button_still_works_and_recovers() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  c.setOnline(false);
  c.tick(t++);
  TEST_ASSERT_EQUAL(State::Offline, c.state());
  for (int i = 0; i < 40; ++i) { c.setButtonRaw(true, t); c.tick(t++); }
  TEST_ASSERT_EQUAL(State::LocalRing, c.state());
  advance(c, t, t + 5100);  // ring 1000 + unlock 3000 + cooldown 1000 -> back to Offline
  TEST_ASSERT_EQUAL(State::Offline, c.state());
  c.setOnline(true);
  c.tick(t++);
  TEST_ASSERT_EQUAL(State::Idle, c.state());
}

void test_led_patterns() {
  uint32_t t = 0;
  Controller c = onlineController(t);
  TEST_ASSERT_FALSE(c.tick(t++).led);                      // idle: off
  c.setOnline(false);
  bool seen_on = false, seen_off = false;
  for (int i = 0; i < 2000; ++i) { Outputs o = c.tick(t++); seen_on |= o.led; seen_off |= !o.led; }
  TEST_ASSERT_TRUE(seen_on && seen_off);                   // offline: blinking
}

void test_buzzer_ring_pattern_timing() {
  Buzzer b;
  uint32_t t = 0;
  b.play(Sound::Ring, t);
  uint32_t on = 0;
  for (; t < 2000; ++t) if (b.tick(t)) ++on;
  TEST_ASSERT_FALSE(b.playing());
  TEST_ASSERT_UINT32_WITHIN(3, 450, on);                   // 150+150+150 ms of sound
}

void test_buzzer_none_is_silent() {
  Buzzer b;
  b.play(Sound::None, 0);
  TEST_ASSERT_FALSE(b.tick(1));
  TEST_ASSERT_FALSE(b.playing());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_starts_offline_then_idle_when_online);
  RUN_TEST(test_unlock_pulses_relay_for_unlock_ms_then_cooldown);
  RUN_TEST(test_relay_high_time_is_exactly_unlock_ms);
  RUN_TEST(test_unlock_during_unlocking_or_cooldown_is_rejected);
  RUN_TEST(test_button_is_debounced);
  RUN_TEST(test_local_ring_then_unlocks_in_demo_mode);
  RUN_TEST(test_local_ring_returns_to_idle_when_demo_unlock_disabled);
  RUN_TEST(test_deny_during_local_ring_cancels_with_denied_sound);
  RUN_TEST(test_offline_button_still_works_and_recovers);
  RUN_TEST(test_led_patterns);
  RUN_TEST(test_buzzer_ring_pattern_timing);
  RUN_TEST(test_buzzer_none_is_silent);
  return UNITY_END();
}
