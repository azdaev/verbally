package main

import (
	"regexp"
	"strings"
)

// rules answers the triage questions with key words when Jev is not there: no TYPESAFE_API_KEY, or Jev failed.
// Most users have no Jev key. Without any answer every phrase goes to the section in view:
// "add a section" grows the hero, "make the whole site dark" changes one section, "uh okay" costs four Claude calls.
// ponytail: English and Russian key words only. Jev reads the sense; these rules read the words.
var (
	ruleFiller   = regexp.MustCompile(`(?i)^[\s.,!?]*((uh+|um+|hm+|okay|ok|so|well|right|yes|no|э+|м+|ну|так|ага|окей|ладно|да|нет|хм+|вот)[\s.,!?-]*)+$`)
	ruleVersions = regexp.MustCompile(`(?i)(variant|version|option|alternative|вариант|верси|альтернатив)`)
	ruleImage    = regexp.MustCompile(`(?i)(photo|image|picture|фото|картин|изображ)`)
	ruleNew      = regexp.MustCompile(`(?i)(add|new|another|one more|добав|нов|ещё одн|еще одн)\S*\s+(\S+\s+){0,3}(section|block|секци|блок|раздел)`)
	ruleAll      = regexp.MustCompile(`(?i)((whole|entire|every|all)\s+(the\s+)?(site|page|section|website)|everywhere|весь сайт|всего сайта|всю страницу|всей страниц|все секции|всех секци|везде|по всему сайту|сайт целиком)`)
	ruleLook     = regexp.MustCompile(`(?i)(ugly|looks?\s+(bad|off|weird|wrong)|не нравится|некрасив|криво|убого|плохо выгляд|выглядит странно)`)
)

// The speaker names a section by its role; the page puts the role into the section name ("top of the page: hero: ...").
var ruleRoles = map[string]*regexp.Regexp{
	"hero":   regexp.MustCompile(`(?i)(hero|хиро|первый экран|главн\S* (экран|блок|секци))`),
	"header": regexp.MustCompile(`(?i)(header|navbar|\bnav\b|menu|хедер|шапк|навигац|меню)`),
	"footer": regexp.MustCompile(`(?i)(footer|футер|подвал)`),
}

func rules(text string, sections []string) map[string]any {
	out := map[string]any{"filler": false, "look": false, "versions": false}
	if ruleFiller.MatchString(text) {
		out["filler"] = true
		return out
	}
	if ruleVersions.MatchString(text) && !ruleImage.MatchString(text) {
		out["versions"] = true
	} else if ruleLook.MatchString(text) {
		out["look"] = true
	}
	switch {
	case ruleNew.MatchString(text):
		out["target"] = "new"
	case ruleAll.MatchString(text):
		out["target"] = "all"
	default:
		for i, name := range sections {
			for role, said := range ruleRoles {
				if said.MatchString(text) && strings.Contains(name, role) {
					out["target"] = i
					return out
				}
			}
		}
	}
	return out
}
