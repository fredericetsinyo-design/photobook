"""Génère templates.json (schéma v2) : modèles v1 + nouveaux modèles issus des références.
Le JSON produit est la seule source lue par l'application ; ce script sert uniquement à l'écrire."""
import json, copy

v1 = json.load(open("templates_v1.json"))

FORMATS = [
    {"id": "A4", "name": "A4", "mm": [210, 297]},
    {"id": "A5", "name": "A5", "mm": [148, 210]},
    {"id": "A3", "name": "A3", "mm": [297, 420]},
    {"id": "card5x7", "name": "Carte 13 × 18", "mm": [127, 178]},
    {"id": "p20x30", "name": "Tirage 20 × 30", "mm": [200, 300]},
    {"id": "p40x50", "name": "Poster 40 × 50", "mm": [400, 500]},
    {"id": "sq20", "name": "Carré 20 × 20", "mm": [200, 200]},
    {"id": "sq30", "name": "Carré 30 × 30", "mm": [300, 300]},
    {"id": "spread30", "name": "Album 30 × 30 (double page 60 × 30)", "mm": [600, 300], "spread": True},
    {"id": "spread3020", "name": "Album 30 × 20 (double page 60 × 20)", "mm": [600, 200], "spread": True},
    {"id": "story", "name": "Story / Réels 9:16 (1080 × 1920 px)", "mm": [101.6, 180.6], "px": [1080, 1920]},
]

CATS_NEW = [
    {"id": "album", "name": "Albums — doubles pages"},
    {"id": "cards", "name": "Cartes, faire-part & remerciements"},
    {"id": "shapes", "name": "Formes : cœur, roue, losanges"},
    {"id": "poster", "name": "Posters & grands collages"},
    {"id": "scrapbook", "name": "Carnet & polaroïds"},
    {"id": "story", "name": "Réseaux sociaux (stories)"},
]

T = []
def add(**t):
    T.append(t)

def S(x, y, w, h, **k):  # emplacement libre en fractions de page
    return dict(b=[x, y, w, h], **k)

def TX(x, y, w, h, content, font="serif", size=0.03, **k):
    return dict(b=[x, y, w, h], content=content, font=font, size=size, **k)

# ---------- ALBUMS (doubles pages) ----------
add(id="album-neuf-mois", name="Neuf mois", category="album", orientation="landscape", formats=["spread30"],
    layout="free", defaults={"gutter": 0},
    slots=[S(.045, .08, .155, .41), S(.205, .08, .155, .41), S(.045, .51, .155, .41), S(.205, .51, .155, .41),
           S(.51, .07, .45, .86, role="hero")],
    text=[TX(.37, .40, .13, .2, "Neuf mois\nsous le cœur", font="script", size=.045, align="center")])
add(id="album-frise-4", name="Frise de quatre", category="album", orientation="landscape", formats=["spread30", "spread3020"],
    layout="grid", grid=[4, 1], defaults={"margin": 14, "gutter": 4},
    slots=[{"r": [i, 0, 1, 1], "prefer": "p"} for i in range(4)])
add(id="album-groupes", name="Groupes & portraits", category="album", orientation="landscape", formats=["spread30"],
    layout="free",
    slots=[S(.04, .08, .21, .4, prefer="l"), S(.26, .08, .21, .4, prefer="l"),
           S(.04, .5, .14, .42), S(.185, .5, .14, .42), S(.33, .5, .14, .42),
           S(.53, .08, .21, .84, role="hero", prefer="p"), S(.75, .08, .21, .84, prefer="p")])
add(id="album-detail-heros", name="Détail, héros & quatuor", category="album", orientation="landscape", formats=["spread30"],
    layout="free",
    slots=[S(.035, .07, .15, .86, prefer="p"), S(.19, .07, .29, .86, role="hero"),
           S(.53, .14, .2, .35), S(.74, .14, .2, .35), S(.53, .51, .2, .35), S(.74, .51, .2, .35)])
add(id="album-recit", name="Récit illustré", category="album", orientation="landscape", formats=["spread30"],
    layout="free",
    slots=[S(.04, .08, .28, .84, role="hero"), S(.33, .08, .14, .41), S(.33, .51, .14, .41),
           S(.72, .08, .24, .84, prefer="p"), S(.53, .5, .18, .42)],
    text=[TX(.53, .12, .18, .3, "La famille\ncommence ici", font="script", size=.05, align="center")])
add(id="album-panoramique", name="Panoramique superposé", category="album", orientation="landscape", formats=["spread3020"],
    layout="free", background={"photo": True, "fade": "right-light"},
    slots=[S(.62, .14, .17, .36, frame="thin"), S(.8, .14, .15, .36, frame="thin"),
           S(.62, .52, .17, .36, frame="thin"), S(.8, .52, .15, .36, frame="thin")],
    text=[TX(.04, .07, .3, .1, "Le jour où tout a commencé", font="serif", size=.07, color="#ffffff", align="left"),
          TX(.04, .85, .3, .08, "AÏCHA & KOFFI", font="sans", size=.04, color="#ffffff", tracking=.4)])

# ---------- PORTFOLIO (éditorial, A4 paysage) ----------
add(id="portfolio-pleine-texte", name="Portfolio : pleine page", category="editorial", orientation="landscape",
    formats=["A4", "A5", "A3"], layout="free",
    slots=[S(0, 0, .66, 1, role="hero")],
    text=[TX(.7, .42, .26, .06, "Nom du projet", font="sansBold", size=.04),
          TX(.7, .5, .26, .2, "Quelques lignes pour présenter\nla séance, le lieu et l'histoire.", font="sans", size=.022)])
add(id="portfolio-quatre-texte", name="Portfolio : quatre + texte", category="editorial", orientation="landscape",
    formats=["A4", "A5", "A3"], layout="free",
    slots=[S(.42, .14, .25, .35), S(.68, .14, .25, .35), S(.42, .51, .25, .35), S(.68, .51, .25, .35)],
    text=[TX(.07, .44, .3, .06, "Nom du projet", font="sansBold", size=.04, align="center"),
          TX(.07, .52, .3, .2, "Texte de présentation\nsur deux ou trois lignes.", font="sans", size=.022, align="center")])
add(id="portfolio-trio-legende", name="Portfolio : trio + légende", category="editorial", orientation="landscape",
    formats=["A4", "A5", "A3"], layout="free",
    slots=[S(.05, .12, .24, .37), S(.05, .51, .24, .37), S(.3, .12, .36, .76, role="hero", prefer="p")],
    text=[TX(.7, .6, .26, .06, "Nom du projet", font="sansBold", size=.04),
          TX(.7, .68, .26, .2, "Lieu · date · légende", font="sans", size=.022)])

# ---------- CARTES ----------
add(id="carte-merci-recto", name="Merci — recto", category="cards", orientation="portrait",
    formats=["card5x7", "A5", "A4"], layout="free",
    slots=[S(0, 0, 1, .8, role="hero", prefer="p")],
    deco=[{"type": "band", "b": [0, .8, 1, .2], "color": "#f4ece4"}, {"type": "band", "b": [0, .88, 1, .045], "color": "#e9c9b4"}],
    text=[TX(.1, .67, .8, .14, "Merci", font="script", size=.11, color="#5b6a8a", align="center"),
          TX(.1, .882, .8, .04, "AÏCHA & KOFFI", font="sans", size=.022, color="#ffffff", align="center")])
add(id="carte-merci-verso", name="Merci — verso", category="cards", orientation="portrait",
    formats=["card5x7", "A5", "A4"], layout="free",
    slots=[S(.06, .05, .43, .26), S(.51, .05, .43, .26), S(.06, .33, .88, .25, role="hero", prefer="l"),
           S(.06, .6, .43, .26), S(.51, .6, .43, .26)],
    deco=[{"type": "band", "b": [.2, .9, .6, .045], "color": "#e9c9b4"}],
    text=[TX(.2, .9, .6, .045, "FREDY PHOTOGRAPHY", font="sans", size=.018, color="#ffffff", align="center")])
add(id="faire-part-date", name="Faire-part daté", category="cards", orientation="portrait",
    formats=["card5x7", "A5", "A4"], layout="free",
    slots=[S(.07, .05, .86, .25, prefer="l"), S(.07, .32, .3, .19), S(.63, .32, .3, .43, prefer="p"),
           S(.07, .53, .53, .42, role="hero"), S(.63, .77, .3, .18)],
    text=[TX(.38, .32, .24, .19, "21\n·\n09\n·\n26", font="sans", size=.03, align="center", color="#333333")])
add(id="poster-titre-mama", name="Grand titre « Maman »", category="cards", orientation="portrait",
    formats=["A4", "A3", "p20x30", "p40x50"], layout="free",
    slots=[S(.055 + c * .3, .04 + r * .23, .285, .215) for r in range(3) for c in range(3) if not (r == 1 and c == 1)],
    deco=[{"type": "heart", "b": [.42, .33, .16, .15], "color": "#8e1b2a", "outline": True}],
    text=[TX(.04, .72, .92, .12, "MAMAN", font="serif", size=.115, color="#8e1b2a", align="center"),
          TX(.04, .83, .92, .06, "tu es notre amour", font="script", size=.05, align="center"),
          TX(.1, .9, .8, .07, "Quel que soit notre âge, près de toi\nnous restons tes enfants.", font="sans", size=.018, align="center")])

# ---------- FORMES ----------
g = .012  # demi-goutière des formes
add(id="forme-losange", name="Losange central", category="shapes", orientation="square", formats=["sq20", "sq30"],
    layout="free", defaults={"stroke": 8},
    slots=[{"shape": {"type": "poly", "pts": [[0, 0], [1, 0], [.5, .5]]}},
           {"shape": {"type": "poly", "pts": [[1, 0], [1, 1], [.5, .5]]}},
           {"shape": {"type": "poly", "pts": [[1, 1], [0, 1], [.5, .5]]}, "role": "hero"},
           {"shape": {"type": "poly", "pts": [[0, 1], [0, 0], [.5, .5]]}}],
    deco=[{"type": "poly", "pts": [[.5, .27], [.73, .5], [.5, .73], [.27, .5]], "color": "#c9b5a6", "stroke": "#ffffff"}],
    text=[TX(.3, .4, .4, .2, "Aïcha\n&\nKoffi", font="sans", size=.045, color="#ffffff", align="center")])
add(id="forme-roue", name="Roue familiale", category="shapes", orientation="square", formats=["sq20", "sq30"],
    layout="free", defaults={"stroke": 6},
    slots=[{"shape": {"type": "sector", "c": [.5, .47], "r0": .155, "r1": .37, "a0": -90 + i * 45, "a1": -45 + i * 45}} for i in range(8)]
          + [{"shape": {"type": "ellipse"}, "b": [.345, .315, .31, .31], "role": "hero", "z": 2}],
    text=[TX(.1, .86, .8, .05, "LOMÉ · FAMILLE MENSAH · 2026", font="sans", size=.022, color="#a08672", align="center")])
add(id="forme-coeur-mosaique", name="Cœur mosaïque", category="shapes", orientation="portrait",
    formats=["A4", "A3", "p40x50"], layout="generator", generator="heart-grid", photos=[16, 40],
    text=[TX(.1, .66, .8, .08, "Aïcha & Koffi", font="script", size=.06, align="center"),
          TX(.1, .74, .8, .04, "24 · 06 · 2026", font="serif", size=.028, align="center")])
add(id="forme-coeur-polaroid", name="Cœur de polaroïds", category="shapes", orientation="square",
    formats=["sq20", "sq30"], layout="generator", generator="heart-scatter", photos=[12, 30],
    text=[TX(.06, .86, .4, .1, "love", font="script", size=.08, align="left")])
add(id="forme-gelules", name="Gélules découpées", category="shapes", orientation="square", formats=["sq20", "sq30"],
    layout="free", photos=[1, 1],
    slots=[S(.03, .37, .14, .26, split="g", shape={"type": "rounded", "r": .5}),
           S(.18, .19, .19, .62, split="g", shape={"type": "rounded", "r": .5}),
           S(.39, .14, .22, .68, split="g", shape={"type": "rounded", "r": .5}),
           S(.63, .19, .19, .62, split="g", shape={"type": "rounded", "r": .5}),
           S(.83, .37, .14, .26, split="g", shape={"type": "rounded", "r": .5})],
    text=[TX(.3, .86, .4, .06, "la famille", font="script", size=.05, align="center")])
add(id="forme-losanges-love", name="Losanges « LOVE »", category="shapes", orientation="portrait",
    formats=["p20x30", "A4", "A3"], layout="free",
    slots=[{"shape": {"type": "poly", "pts": [[.25, 0], [.6, 0], [.42, .13]]}},
           {"shape": {"type": "poly", "pts": [[.08, .02], [.45, .27], [.08, .5]]}},
           {"shape": {"type": "poly", "pts": [[.78, .03], [.97, .17], [.97, .5], [.6, .25]]}},
           {"shape": {"type": "poly", "pts": [[.5, .33], [.83, .57], [.5, .82], [.17, .57]]}, "role": "hero"},
           {"shape": {"type": "poly", "pts": [[.08, .75], [.38, .97], [.08, .97]]}},
           {"shape": {"type": "poly", "pts": [[.78, .67], [.97, .8], [.97, .97], [.55, .97]]}}],
    text=[TX(.47, .14, .14, .12, "L", font="serif", size=.11), TX(.06, .52, .12, .12, "O", font="serif", size=.11),
          TX(.78, .58, .14, .12, "V", font="serif", size=.11), TX(.4, .82, .14, .13, "E", font="serif", size=.11),
          TX(.48, .27, .2, .05, "Ton amour me porte\nchaque jour.", font="serif", size=.013),
          TX(.6, .9, .25, .05, "Pour toujours,\nmain dans la main.", font="serif", size=.013)])

# ---------- POSTERS ----------
add(id="poster-carres-texte", name="Grand collage carrés + titre", category="poster", orientation="landscape",
    formats=["A4", "A3", "p40x50"], layout="grid", grid=[9, 6], defaults={"margin": 8, "gutter": 2},
    slots=[{"r": [c, r, 1, 1], "prefer": "s"} for r in range(6) for c in range(9) if not (3 <= c <= 5 and 2 <= r <= 3)],
    text=[{"r": [3, 2, 3, 2], "content": "NOTRE ANNÉE\nFamille Mensah\nLomé · 2026", "font": "serif", "size": .035, "align": "center"}])
add(id="poster-heros-anneau", name="Héros entouré", category="poster", orientation="square",
    formats=["sq30", "p40x50", "A3"], layout="grid", grid=[7, 6], defaults={"margin": 10, "gutter": 2.5},
    slots=[{"r": [2, 1, 3, 3], "role": "hero"}] + [{"r": [c, r, 1, 1]} for r in range(5) for c in range(7) if not (2 <= c <= 4 and 1 <= r <= 3)],
    text=[{"r": [0, 5, 7, 1], "content": "Votre message personnel ici", "font": "script", "size": .05, "align": "center"}])
add(id="poster-heros-legende", name="Héros + texte sous la photo", category="poster", orientation="landscape",
    formats=["A4", "A3", "p40x50"], layout="grid", grid=[7, 5], defaults={"margin": 10, "gutter": 2.5},
    slots=[{"r": [2, 1, 3, 3], "role": "hero"}] + [{"r": [c, 0, 1, 1]} for c in range(7)]
          + [{"r": [c, r, 1, 1]} for r in (1, 2, 3) for c in (0, 1, 5, 6)] + [{"r": [0, 4, 1, 1]}, {"r": [6, 4, 1, 1]}],
    text=[{"r": [1, 4, 5, 1], "content": "VOTRE TEXTE\nPERSONNALISÉ ICI", "font": "serif", "size": .045, "align": "center"}])
add(id="poster-famille-14", name="Famille quatorze", category="poster", orientation="portrait",
    formats=["A4", "A3", "p40x50"], layout="grid", grid=[4, 5], defaults={"margin": 10, "gutter": 3},
    slots=[{"r": [0, 0, 2, 2], "role": "hero"}, {"r": [2, 0, 1, 1]}, {"r": [3, 0, 1, 1]}, {"r": [2, 1, 1, 1]}, {"r": [3, 1, 1, 1]},
           {"r": [0, 2, 1, 1]}, {"r": [1, 2, 1, 1]}, {"r": [2, 2, 1, 1]}, {"r": [3, 2, 1, 1]},
           {"r": [0, 3, 1, 1]}, {"r": [1, 3, 1, 1]}, {"r": [0, 4, 1, 1]}, {"r": [1, 4, 1, 1]}, {"r": [2, 3, 2, 2]}])
add(id="poster-bilan-annee", name="Bilan de l'année", category="poster", orientation="portrait",
    formats=["A4", "A3", "p40x50"], layout="grid", grid=[6, 9], defaults={"margin": 8, "gutter": 2.5},
    slots=[{"r": [0, 0, 2, 2]}, {"r": [2, 0, 2, 3]}, {"r": [4, 0, 2, 4], "role": "hero", "prefer": "p"}, {"r": [0, 2, 2, 2]},
           {"r": [2, 3, 2, 1]}, {"r": [4, 4, 2, 1]}, {"r": [0, 5, 3, 2]}, {"r": [3, 5, 1, 2]}, {"r": [4, 5, 2, 2]},
           {"r": [0, 7, 1, 2]}, {"r": [1, 7, 2, 2]}, {"r": [3, 7, 1, 2]}, {"r": [4, 7, 2, 2]}],
    text=[{"r": [0, 4, 4, 1], "content": "MERCI\npour cette belle année 2026", "font": "serif", "size": .03, "align": "center"}])
add(id="poster-carte-postale", name="Carte postale quinze", category="poster", orientation="landscape",
    formats=["A4", "A5", "card5x7", "A3"], layout="grid", grid=[7, 5], defaults={"margin": 8, "gutter": 2},
    slots=[{"r": [0, 0, 2, 2]}, {"r": [0, 2, 1, 1]}, {"r": [1, 2, 1, 1]}, {"r": [0, 3, 2, 2]},
           {"r": [2, 0, 1, 1]}, {"r": [3, 0, 1, 1]}, {"r": [4, 0, 1, 1]}, {"r": [2, 1, 3, 3], "role": "hero"},
           {"r": [2, 4, 1, 1]}, {"r": [3, 4, 1, 1]}, {"r": [4, 4, 1, 1]},
           {"r": [5, 0, 2, 2]}, {"r": [5, 2, 1, 1]}, {"r": [6, 2, 1, 1]}, {"r": [5, 3, 2, 2]}])

# ---------- CRÉATIFS : briques, arrondis, panorama ----------
add(id="creatif-briques", name="Briques décalées", category="creative", orientation="portrait",
    formats=["A4", "A3", "p20x30"], layout="grid", grid=[12, 24], defaults={"margin": 6, "gutter": 3},
    slots=[{"r": [0, 0, 3, 8], "prefer": "p"}, {"r": [0, 8, 3, 8], "prefer": "p"},
           {"r": [3, 0, 6, 6], "prefer": "l"}, {"r": [3, 6, 6, 5], "prefer": "l"}, {"r": [3, 11, 6, 5], "prefer": "l"},
           {"r": [9, 0, 3, 8], "prefer": "p"}, {"r": [9, 8, 3, 8], "prefer": "p"},
           {"r": [0, 16, 6, 8], "role": "hero"}, {"r": [6, 16, 6, 8]}])
add(id="creatif-arrondis", name="Mosaïque arrondie", category="creative", orientation="portrait",
    formats=["A4", "A3", "p20x30"], layout="grid", grid=[4, 6], defaults={"margin": 10, "gutter": 3},
    slotDefaults={"shape": {"type": "rounded", "r": .12}},
    slots=[{"r": [0, 0, 1, 2]}, {"r": [1, 0, 3, 1], "prefer": "l"}, {"r": [1, 1, 2, 2], "role": "hero"}, {"r": [3, 1, 1, 1]},
           {"r": [0, 2, 1, 1]}, {"r": [3, 2, 1, 1]}, {"r": [0, 3, 1, 2]}, {"r": [1, 3, 2, 1], "prefer": "l"}, {"r": [3, 3, 1, 1]},
           {"r": [1, 4, 1, 2]}, {"r": [2, 4, 2, 1], "prefer": "l"}, {"r": [0, 5, 1, 1]}, {"r": [2, 5, 1, 1]}, {"r": [3, 5, 1, 1]}])
add(id="famille-panorama-centre", name="Panorama central", category="family", orientation="portrait",
    formats=["A4", "A5", "A3", "p20x30"], layout="grid", grid=[12, 12], defaults={"margin": 4, "gutter": 2},
    slots=[{"r": [0, 0, 6, 3], "prefer": "l"}, {"r": [6, 0, 6, 3], "prefer": "l"}, {"r": [0, 3, 12, 6], "role": "hero", "prefer": "l"},
           {"r": [0, 9, 4, 3]}, {"r": [4, 9, 8, 3], "prefer": "l"}])

# ---------- CARNET & POLAROÏDS ----------
add(id="carnet-polaroids", name="Carnet de polaroïds", category="scrapbook", orientation="portrait",
    formats=["A4", "A3", "p40x50"], layout="free", background={"color": "#f4efe6"},
    slots=[S(.12, .2, .76, .6, role="hero", frame="thin", z=1),
           S(.02, .01, .36, .28, frame="polaroid", caption="Notre 8e année", rotate=-3, z=2),
           S(.66, .02, .32, .3, frame="polaroid", caption="Pour toujours", rotate=2, z=2, prefer="p"),
           S(.02, .7, .26, .26, frame="polaroid", rotate=-4, z=3),
           S(.25, .76, .22, .22, frame="polaroid", rotate=3, z=4),
           S(.66, .7, .32, .28, frame="polaroid", caption="Famille", rotate=2, z=3)],
    deco=[{"type": "heart", "b": [.07, .52, .04, .035], "color": "#e3a7a7"}, {"type": "heart", "b": [.88, .6, .04, .035], "color": "#e3a7a7"}])
add(id="carnet-epingles", name="Polaroïds épinglés", category="scrapbook", orientation="portrait",
    formats=["A4", "A3", "p20x30"], layout="free", background={"color": "#e8d8c3"},
    slots=[S(.22, .37, .56, .3, role="hero", frame="thin", rotate=-1, z=1, prefer="l"),
           S(.08, .2, .32, .23, frame="polaroid", rotate=-5, z=2), S(.6, .2, .32, .23, frame="polaroid", rotate=5, z=2),
           S(.08, .62, .32, .23, frame="polaroid", rotate=-5, z=2), S(.6, .62, .32, .23, frame="polaroid", rotate=6, z=2),
           S(.36, .75, .28, .2, frame="polaroid", z=3)],
    deco=[{"type": "band", "b": [.15, .05, .7, .1], "color": "#b9907a", "rotate": -1},
          {"type": "pin", "b": [.21, .19, .035, .025]}, {"type": "pin", "b": [.75, .19, .035, .025]},
          {"type": "pin", "b": [.21, .61, .035, .025]}, {"type": "pin", "b": [.75, .61, .035, .025]}, {"type": "pin", "b": [.48, .74, .035, .025]}],
    text=[TX(.15, .05, .7, .1, "La famille avant tout", font="script", size=.05, color="#5a3a2a", align="center")])
add(id="carnet-chevauchement", name="Souvenirs superposés", category="scrapbook", orientation="portrait",
    formats=["A4", "A3", "p20x30"], layout="free", background={"color": "#efe5d6"},
    slots=[S(.03 + c * .32, .02 + r * .195, .31, .2, frame="thin", rotate=[-2, 1.5, -1, 2, -1.5][(r + c) % 5], z=(r * 3 + c) % 4 + 1)
           for r in range(5) for c in range(3)],
    deco=[{"type": "heart", "b": [.01, .2, .045, .035], "color": "#f1a7b0"}, {"type": "heart", "b": [.9, .22, .045, .035], "color": "#f6c8c8"},
          {"type": "heart", "b": [.88, .9, .045, .035], "color": "#f6c8c8"}])
add(id="carnet-kraft", name="Carnet kraft", category="scrapbook", orientation="portrait",
    formats=["A4", "A3", "p20x30"], layout="free", background={"color": "#d9b8a0"},
    slots=[S(.09, .06, .46, .37, frame="thin", z=1, role="hero"), S(.56, .04, .36, .22, frame="thin", rotate=-1.5, z=2),
           S(.55, .29, .36, .16, frame="thin", z=1), S(.12, .57, .47, .14, frame="thin", z=1, prefer="l"),
           S(.06, .74, .36, .22, frame="thin", rotate=-2, z=2), S(.52, .62, .41, .34, frame="thin", rotate=2, z=2, prefer="p")],
    deco=[{"type": "band", "b": [.05, .46, .9, .08], "color": "#f7f2ea", "rotate": -1},
          {"type": "tape", "b": [.1, .725, .1, .025], "rotate": -8}, {"type": "tape", "b": [.78, .93, .12, .025], "rotate": -10}],
    text=[TX(.05, .46, .9, .08, "La famille, c'est tout", font="script", size=.045, color="#7a5642", align="center")])

# ---------- COUPLE ----------
add(id="couple-love-vertical", name="LOVE vertical", category="couple", orientation="portrait",
    formats=["A4", "A5", "p20x30"], layout="free",
    slots=[S(.06, .05, .43, .31), S(.51, .05, .43, .45, role="hero"), S(.06, .37, .43, .58, prefer="p"), S(.51, .51, .43, .44)],
    text=[TX(.4, .08, .2, .8, "LOVE", font="display", size=.21, color="#ffffff", stack=True, align="center")])
add(id="couple-triptyque-titre", name="Triptyque & titre", category="couple", orientation="portrait",
    formats=["A4", "p20x30", "A3"], layout="free", background={"color": "#f3f1ee"},
    slots=[S(.03, .01, .3, .69, fade="bottom-dark"), S(.35, .01, .3, .69, fade="bottom-dark"), S(.67, .01, .3, .69, fade="bottom-dark"),
           S(.27, .42, .46, .44, role="hero", frame="thin", z=3, prefer="p")],
    text=[TX(.1, .3, .8, .1, "Aïcha & Koffi", font="script", size=.075, color="#e8e8e8", align="center", z=2),
          TX(.2, .885, .6, .045, "06 · 12 · 2026", font="sansBold", size=.03, align="center"),
          TX(.2, .935, .6, .03, "ENSEMBLE POUR TOUJOURS", font="sans", size=.016, align="center", tracking=.4)])

# ---------- STORIES 9:16 ----------
add(id="story-6-plein", name="Story six pleine page", category="story", orientation="portrait", formats=["story"],
    layout="grid", grid=[2, 3], defaults={"margin": 0, "gutter": 0.8},
    slots=[{"r": [c, r, 1, 1]} for r in range(3) for c in range(2)])
add(id="story-9-plein", name="Story neuf pleine page", category="story", orientation="portrait", formats=["story"],
    layout="grid", grid=[3, 3], defaults={"margin": 0, "gutter": 0.6},
    slots=[{"r": [c, r, 1, 1], "prefer": "p"} for r in range(3) for c in range(3)])
add(id="story-6-blanc", name="Story six à bordures", category="story", orientation="portrait", formats=["story"],
    layout="grid", grid=[2, 3], defaults={"margin": 0, "gutter": 3},
    slots=[{"r": [c, r, 1, 1]} for r in range(3) for c in range(2)])

# ---------- assemblage ----------
out = copy.deepcopy(v1)
out["schemaVersion"] = 2
out["notes"] = ("layout=grid : la zone utile (page - marges) est découpée en grille [colonnes, lignes] ; emplacement r=[col, ligne, largeur, hauteur]. "
                "layout=free : emplacement b=[x, y, largeur, hauteur] en fractions de la page. "
                "shape : rect (défaut), rounded {r}, ellipse, poly {pts en fractions de page}, sector {c, r0, r1, a0, a1}. "
                "Options : rotate (degrés), frame (thin|polaroid) + caption, z (superposition), split (une même photo répartie sur plusieurs emplacements), "
                "fade (bottom-dark|right-light), role=hero, prefer=p|l|s. background : couleur ou photo pleine page. "
                "text : zones de texte (font script|serif|serifBold|sans|sansBold|display, size en fraction de la hauteur de page, stack=lettres empilées). "
                "deco : band, heart, pin, tape, poly. generator : justified-rows | heart-grid | heart-scatter.")
out["formats"] = FORMATS
out["fonts"] = {"script": "Great Vibes", "serif": "Playfair Display", "serifBold": "Playfair Display 700",
                "sans": "Montserrat", "sansBold": "Montserrat 700", "display": "Anton"}
out["categories"] += CATS_NEW
for t in out["templates"]:
    t.setdefault("layout", "generator" if t.get("generator") else "grid")
    if "custom" in t["formats"]:
        t["formats"] = [f for f in t["formats"] if f != "custom"] + (["A3", "p20x30"] if t["orientation"] == "portrait" else ["A3"])
out["templates"] += T

def nphotos(t):
    if "photos" in t: return t["photos"]
    if t.get("sameImage"): return [1, 1]
    if t.get("slots") == "auto": return [1, t["grid"][0] * t["grid"][1]]
    n = len(t["slots"]) + (1 if t.get("background", {}).get("photo") else 0)
    return [n, n]
for t in out["templates"]:
    t["photos"] = nphotos(t)
json.dump(out, open("templates.json", "w"), ensure_ascii=False, indent=1)
print(len(out["templates"]), "modèles,", len(out["categories"]), "catégories,", len(FORMATS), "formats")
