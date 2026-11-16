package main

import "testing"

func TestRules(t *testing.T) {
	secs := []string{"top of the page: header: Kiln & Bean Coffee Visit", "hero: Roasted this week", "prices", "footer: © 2026"}
	for _, c := range []struct {
		text, key string
		want      any
	}{
		{"uh okay", "filler", true},
		{"Ну, так, э-э.", "filler", true},
		{"okay make it blue", "filler", false},
		{"add a section with teacher photos", "target", "new"},
		{"добавь секцию с отзывами", "target", "new"},
		{"make the whole site darker", "target", "all"},
		{"сделай весь сайт светлым", "target", "all"},
		{"make the hero heading orange", "target", 1},
		{"шапку сделай прозрачной", "target", 0},
		{"в футере поменяй почту", "target", 3},
		{"make the heading green", "target", nil},
		{"сделай два других варианта хедера", "versions", true},
		{"дай 5 вариантов фото", "versions", false},
		{"Give me three variations of this element", "versions", true},
		{"покажи вариации этой карточки", "versions", true},
		{"improve the conversion of this button", "versions", false},
		{"повысь конверсию этой кнопки", "versions", false},
		{"this looks bad", "look", true},
	} {
		if got := rules(c.text, secs)[c.key]; got != c.want {
			t.Errorf("%q: %s = %v, want %v", c.text, c.key, got, c.want)
		}
	}
}
