# Zeversolar pour Gladys Assistant

Connecteur non officiel, sans lien avec Zeversolar. Il lit votre onduleur
solaire Zeversolar sur votre réseau local, par la page d'état de sa carte
Wi-Fi, sans cloud et sans compte.

**Jamais testé avec un vrai onduleur Zeversolar** : il a été construit à partir
de la bibliothèque zeversolar (celle qu'utilise Home Assistant) et des
exemples de sa documentation. Merci de signaler ce que vous voyez (voir
« Retours » plus bas).

## Ce que vous obtenez

Un appareil Gladys par onduleur, nommé d'après son numéro de série :

| Fonction                          | Ce que c'est                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Production solaire (W)            | la puissance produite en ce moment ; 0 la nuit                                           |
| Énergie solaire du jour (kWh)     | le compteur du jour de l'onduleur, tel qu'il le donne                                    |
| Index de production solaire (kWh) | un index cumulé pour le suivi énergétique de Gladys (production par demi-heure, revenus) |
| Onduleur éveillé                  | 1 quand l'onduleur produit ou est prêt, 0 en veille (la nuit)                            |
| Défaut de l'onduleur              | 1 quand l'onduleur signale une erreur                                                    |
| Liaison au cloud Zeversolar       | 1 quand la carte Wi-Fi est connectée au cloud du fabricant                               |

Lecture seule : l'intégration n'envoie jamais de commande à l'onduleur (pas de
marche/arrêt, pas de limite de puissance).

## Mise en place

1. Trouvez l'adresse IP de l'onduleur dans votre box (sa carte Wi-Fi y
   apparaît comme un appareil du réseau). Donnez-lui si possible une adresse
   fixe.
2. Dans Gladys, ouvrez l'intégration, saisissez l'adresse (de jour : la nuit
   l'onduleur dort et ne répond pas) et enregistrez.
3. Ouvrez l'onglet « Découverte » et créez l'appareil. Ses valeurs arrivent à
   la lecture suivante (dans la minute de jour).

Le bouton « Tester la connexion » lit l'onduleur si une lecture est due, sinon
il donne la dernière lecture : l'intégration ne lit jamais plus d'une fois par
minute, quoi qui le demande.

## La nuit

Un onduleur Zeversolar est alimenté par ses panneaux : au coucher du soleil il
s'arrête, et sa carte Wi-Fi répond sans production ou se tait. Ce n'est pas une
erreur : après trois lectures sans réponse (ou tout de suite quand la carte le
dit), l'onduleur est « en veille », sa puissance passe à 0, l'état reste vert
et le dit, et il est lu toutes les 5 minutes jusqu'à son réveil. L'état ne
passe au rouge que si l'onduleur disparaît en pleine production, répond autre
chose que sa page d'état, ou ne donne aucune lecture pendant plus d'un jour.

## L'index d'énergie

L'onduleur ne donne qu'un compteur du jour (il repart chaque matin), jamais un
compteur depuis sa mise en service, alors que le suivi énergétique de Gladys
compte les hausses d'un index cumulé. L'intégration en construit donc un :
l'index repart de sa dernière valeur et ajoute ce que le compteur du jour
ajoute. Il ne repasse jamais à 0 et ne baisse jamais : un nouveau jour (le
compteur revenu à 0 le matin) le laisse où il était. Tout doute compte moins,
jamais plus : un redémarrage de l'onduleur dans la journée, un compteur qui
saute, des heures sans lecture autour du changement de jour.

L'index passe aussi par une garde : un saut ou une baisse de l'index lui-même
est retenu, affiché dans l'état de l'intégration, et pris seulement quand vous
cliquez sur « Accepter l'index retenu » dans la configuration (un saut est
alors compté d'un coup, une baisse ne compte rien). Enregistrer la
configuration ne l'accepte jamais.

## Limites

- Seul le premier onduleur est lu quand la carte Wi-Fi en signale plusieurs.
- L'énergie du jour est lue comme la bibliothèque la lit : un seul chiffre
  après la virgule est un zéro manquant (« 14.9 » veut dire 14,09 kWh).
- L'intégration demande Gladys 5.2.0 ou plus récent.

## Vie privée

Rien ne sort de votre réseau : l'intégration ne parle qu'à l'adresse saisie,
avec une petite requête GET par minute (toutes les 5 minutes la nuit). La clé
d'enregistrement de la carte Wi-Fi (sa clé pour le cloud du fabricant) n'est
jamais gardée, journalisée ni affichée.

## Retours

Tickets et contributions : <https://github.com/LM1LC3N7/gladys-zeversolar>. Si
vous avez un onduleur Zeversolar, le texte de `http://<adresse>/home.cgi` (de
jour et de nuit, clé d'enregistrement et numéros de série masqués) aide
beaucoup.
