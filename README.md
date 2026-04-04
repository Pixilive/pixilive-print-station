# Pixilive Print Station — Installation et utilisation

Pixilive Print Station connecte ton imprimante DNP à Pixilive pour proposer des impressions photo instantanées lors de tes événements.

👉 [Télécharger la dernière version](https://github.com/Pixilive/pixilive-print-station/releases)
Sur la page qui s'ouvre, télécharge le fichier Pixilive.Print.Station-X.X.X-arm64.dmg.
---

## 1. Installer l'app

Ouvre le fichier **Pixilive Print Station.dmg** et glisse l'app dans ton dossier Applications.

---

## 2. Premier lancement

macOS peut bloquer l'ouverture de l'app car elle n'est pas distribuée via l'App Store. Pas d'inquiétude, c'est normal.

**Option A — Via les Réglages système (recommandé)**

1. Va dans **Réglages système** → **Confidentialité et sécurité**
2. Fais défiler vers le bas jusqu'à voir le message *"Pixilive Print Station a été bloquée"*
3. Clique sur **"Ouvrir quand même"**
4. Confirme dans la boîte de dialogue

**Option B — Via le Terminal**

1. Ouvre le Terminal : **Cmd+Espace** → tape `Terminal` → Entrée
2. Copie-colle cette commande et appuie sur Entrée :

```
xattr -cr "/Applications/Pixilive Print Station.app"
```

3. Lance l'app normalement depuis Applications

---

## 3. Configuration

Au premier lancement, clique sur l'icône dans la barre de menu en haut à droite → **Paramètres** :

- **Imprimante** : sélectionne ta DNP dans la liste
- **Format papier** : choisis le format correspondant au papier chargé
- **Masques** : importe tes fichiers PNG portrait et paysage si besoin
- Clique **Enregistrer**

---

## 4. Deux modes d'impression (depuis Pixilive)

### Impression avec modération

Les participants demandent leurs photos depuis la galerie Pixilive. Un animateur connecté au backoffice valide et déclenche l'impression quand ils se présentent devant lui.

**Avantages** : temps réel, file d'attente visible, statut mis à jour dans Pixilive.

**Idéal pour** : événements avec animateur, stand photo, bar à impression.

---

### Impression automatique (via Dropbox Hotfolder)

L'app surveille un dossier local en permanence. Dès qu'une image y apparaît, elle est automatiquement imprimée puis archivée dans un sous-dossier `_printed`.

Ce mode fonctionne avec Dropbox : Dropbox synchronise les images dans le dossier surveillé, l'app les imprime au fur et à mesure.

**Pour l'activer** :
1. Va dans **Paramètres** → section **Hotfolder**
2. Active le toggle
3. Clique sur **Choisir le dossier** et sélectionne ton dossier Dropbox Pixilive
4. Clique **Enregistrer**

**Avantages** : fonctionne sans intervention de l'animateur, compatible avec les workflows Dropbox existants.

**Idéal pour** : usage solo, impressions à distance, événements sans animateur.

---

## 5. Le port local (4242)

L'app utilise le port **4242** pour communiquer avec Pixilive. Ce port est configuré par défaut et ne nécessite aucune modification dans la grande majorité des cas.

Si l'app indique que le port est déjà utilisé par une autre application, tu peux le changer dans **Paramètres** → **Port local**. N'importe quel nombre entre 1024 et 65535 convient.

---

## 6. Utilisation au quotidien

L'app doit être installée et lancée sur l'ordinateur directement connecté à l'imprimante DNP en USB.

Lance l'app en début d'événement — elle apparaît dans la barre de menu en haut à droite (icône imprimante). Elle doit rester ouverte pendant toute la durée de l'événement pour recevoir et traiter les impressions.

Un clic sur l'icône affiche la file d'attente en cours. Un clic sur **Paramètres** permet de modifier la configuration à tout moment.

---

## 7. Mises à jour

L'app te notifie automatiquement quand une nouvelle version est disponible. Tu peux aussi consulter l'historique des versions sur :

👉 [github.com/Pixilive/pixilive-print-station/releases](https://github.com/Pixilive/pixilive-print-station/releases)

---

Pour toute question : contact@pixi.live
