# MymiHouseBoucletteBuilder

Logiciel de plans de maison : plan 2D coté façon architecte, pièces et surfaces automatiques, portes, fenêtres, meubles, toiture (4 pans, 2 pans, plat), vue 3D avec visite à pied, coupe, façades, plan de masse et export PDF prêt pour un dossier de permis de construire.

## Lancer

Double-cliquez sur **« Lancer MymiHouseBoucletteBuilder.command »**. Une fenêtre Terminal s'ouvre (laissez-la ouverte) et l'application s'ouvre dans votre navigateur à l'adresse http://localhost:8765.

Au premier lancement, macOS peut demander une confirmation : clic droit sur le fichier → **Ouvrir**.

## Prise en main

1. **Murs extérieurs** (touche `M`) : cliquez point par point. Tapez une longueur (`4,50` en mètres ou `450` en cm) puis `Entrée` pour un mur à la cote exacte. Double-clic pour terminer.
2. **Cloisons** (`C`) de la même façon : elles s'accrochent aux murs existants. Les pièces et leurs surfaces apparaissent dès qu'un contour est fermé. Double-clic sur une pièce pour la renommer.
3. **Portes et fenêtres** : choisissez un type à gauche, cliquez sur un mur. Dimensions et sens d'ouverture dans le panneau de droite.
4. **Bibliothèque** : cliquez sur un meuble, puis sur le plan. `R` pour pivoter.
5. **Toiture** : bouton « Toiture » → posée automatiquement sur l'emprise. Pente, débord, type et couverture réglables.
6. **Ligne de coupe** et **Parcelle** : pour les onglets « Coupe » et « Plan de masse ».
7. **Exporter PDF** : génère le dossier A3 (plan de masse, plan, coupe, façades, perspective 3D) avec cartouche.

## Étages (plusieurs niveaux)

- La barre des **niveaux**, en haut à droite du plan, passe d'un niveau à l'autre. **＋ Étage** crée un étage avec les mêmes murs extérieurs que le niveau affiché.
- Panneau de droite, section **Niveau** : nom, hauteur sous plafond, épaisseur des planchers, « Niveau en dessous », « Importer un niveau (fichier) » pour ajouter un autre projet MymiHouseBoucletteBuilder comme étage, monter / descendre / supprimer, « Décaler ce niveau » pour l'aligner.
- Le niveau voisin s'affiche en bleu clair sous le plan, et les murs s'y accrochent.
- Une pièce nommée **Trémie** (ou « Vide sur séjour ») perce le plancher de l'étage et ne compte pas dans la surface habitable.
- La 3D, les façades, la coupe, le plan de masse et le PDF (un plan par niveau) tiennent compte de tous les niveaux. En 3D, le bouton « Niveaux » n'affiche que jusqu'au niveau choisi pour voir l'intérieur.
- Chaque toiture est attachée au niveau sur lequel elle a été posée (outil Toiture depuis ce niveau) : on peut couvrir un rez-de-chaussée plus large que l'étage.
- Les anciens fichiers (un seul niveau) s'ouvrent normalement et sont convertis.

## Reprendre un plan existant (PDF, scan ou photo)

1. **Importer PDF** (groupe « Plan existant ») : choisissez le fichier PDF ou l'image. Il s'affiche en transparence sous le dessin.
2. **Mettre à l'échelle** : cliquez 2 points dont vous connaissez la distance réelle (par ex. les extrémités d'une cote « 4,50 » lisible sur le plan), tapez `4,50`, `Entrée`. Le fond est alors aux bonnes dimensions et verrouillé.
3. Redessinez les murs par-dessus avec « Mur extérieur » puis « Cloison ». Opacité, rotation, déplacement et verrouillage sont dans le panneau de droite.

La conversion automatique des traits en murs n'est volontairement pas proposée : trop peu fiable.

Raccourcis : `V` sélection · `M` mur · `C` cloison · `R` pièce rectangle · `P` porte · `F` fenêtre · `D` cote · `A` ajuster la vue · `Suppr` supprimer · `⌘Z` annuler · `Échap` annuler l'outil.

Le projet est sauvegardé automatiquement dans le navigateur. « Enregistrer » crée un fichier `.archiplan.json` réutilisable avec « Ouvrir ».

## Structure

- `index.html`, `css/style.css` : interface
- `js/app.js` : outils, souris/clavier, panneaux
- `js/model.js` : données, historique, sauvegarde
- `js/topology.js` : détection automatique des pièces et de l'emprise
- `js/walls.js` : géométrie des murs et ouvertures
- `js/render2d.js` : plan 2D et cotations
- `js/elev.js` : façades et coupe
- `js/masse.js` : plan de masse
- `js/roof.js` : toitures
- `js/view3d.js` : vue 3D (Three.js) et visite à pied
- `js/export.js` : PDF (jsPDF) et PNG
- `js/furniture.js` : bibliothèque de meubles
- `js/background.js` : fond de plan (import PDF via pdf.js / image, mise à l'échelle)
- `js/example.js` : maison d'exemple
- `test/smoke.mjs` : test rapide (`node test/smoke.mjs`)
- `vendor/` : Three.js 0.160 et jsPDF 2.5.1 (hors ligne)

## Assistant ✨ (modifier le plan en tapant une phrase)

Bouton **✨ Assistant** en haut : « décale la cloison entre la chambre 2 et la douche de 30 cm vers la douche », « volets vert sauge », « bardage bois vertical noir sur la façade est »…
Il faut une clé **Google Gemini gratuite** (aistudio.google.com/apikey), à coller via ⚙. Elle reste dans le navigateur. Chaque demande s'annule avec ⌘Z.
Le code est dans `js/assistant.js` ; test hors ligne : `node test/assistant.mjs`.
