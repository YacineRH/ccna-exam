import { z } from 'zod';

/**
 * Profil de terminal : tout ce qui fait d'un simulateur générique un IOS, un JunOS ou autre.
 * Modes et prompts, messages d'erreur, types d'interfaces, catalogue des commandes et leurs effets.
 * C'est une donnée (packages/content), jamais du code : le moteur ne connaît que des modes et des commandes.
 */

const requirementSchema = z
  .object({
    /** Variable de l'équipement à contrôler (`hostname`, `rsaModulus`…). */
    var: z.string().optional(),
    /** La variable doit exister et valoir au moins ce nombre. */
    min: z.number().optional(),
    /** La variable ne doit pas valoir cette chaîne (insensible à la casse ; variables permises, `{defaultHostname}`). */
    notEquals: z.string().optional(),
    /** Une ligne de la configuration globale doit correspondre à cette expression (insensible à la casse). */
    config: z.string().optional(),
    /** Aucune ligne de la configuration globale ne doit correspondre (`{$1}` : paramètre, échappé). */
    notConfig: z.string().optional(),
    /** Chaque section visée (interface…) doit contenir une ligne qui correspond à cette expression. */
    section: z.string().optional(),
    /**
     * Paramètres [adresse, masque] (numéros à partir de 1) : l'adresse doit être une adresse d'hôte du sous-réseau,
     * ni l'adresse du réseau ni celle de diffusion (sauf /31 et /32). Message : `{prefix}`, `{address}`.
     */
    ipv4Host: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
    /**
     * Le paramètre n° `param` ne doit égaler aucune valeur capturée (groupe 1) par `pattern` dans les lignes
     * des sections de l'équipement : un prochain saut qui est l'adresse d'une interface du routeur.
     */
    notInSections: z.object({ param: z.number().int().min(1), pattern: z.string().min(1) }).optional(),
    /** Le paramètre n° `param` (à partir de 1) ne doit pas correspondre à `notMatch` (insensible à la casse). */
    param: z.number().int().min(1).optional(),
    notMatch: z.string().optional(),
    /**
     * Garde : la condition ne s'applique que si le paramètre n° `param` (à partir de 1) est un nombre
     * compris entre `min` et `max` (`standby 300 …` exige `standby version 2`).
     */
    when: z.object({ param: z.number().int().min(1), min: z.number().optional(), max: z.number().optional() }).optional(),
    /** Refus présenté comme une saisie invalide, le marqueur `^` sous le paramètre n° `invalidAt`. */
    invalidAt: z.number().int().min(1).optional(),
    /** Message affiché si la condition n'est pas remplie. `{target}` : section visée. */
    message: z.string().min(1).optional(),
  })
  .refine((r) => r.var !== undefined || r.config !== undefined || r.section !== undefined || r.notConfig !== undefined || r.ipv4Host !== undefined || r.notInSections !== undefined || (r.param !== undefined && r.notMatch !== undefined), {
    message: 'une condition porte sur var, config, section ou param + notMatch',
  })
  .refine((r) => r.message !== undefined || r.invalidAt !== undefined, { message: 'message ou invalidAt attendu' });

export const terminalCommandSchema = z.object({
  /**
   * Syntaxe : mots-clés en minuscules, paramètres entre chevrons, `[…]` optionnel, `{a|b}` alternative.
   * Paramètres : <ipv4>, <ipv4-mask>, <wildcard>, <ipv6>, <ipv6-prefix>, <prefix-length>, <word>, <line>,
   * <a-b> (entier borné), <interface>, <interface-range>, <vlan-list>, <port>, <port:table> (noms de ports
   * de la table `portNames.table`, `<port:tcp>`), <mac>, <area>.
   */
  syntax: z.string().min(1),
  modes: z.array(z.string().min(1)).min(1),
  /** Types d'équipement qui offrent la commande ; tous si absent. */
  devices: z.array(z.string()).optional(),
  /**
   * Types d'interface sur lesquels la commande existe, par type d'équipement (`*` : tous les équipements).
   * Ailleurs, elle est inconnue (`% Invalid input`), comme `clock rate` hors d'une interface série.
   */
  onInterfaces: z.record(z.array(z.string().min(1))).optional(),
  /**
   * Lignes de la même section retirées quand la commande est saisie (`passive-interface default` efface
   * les `passive-interface X` devenues inutiles), expression insensible à la casse.
   */
  clears: z.string().min(1).optional(),
  /** Rang d'affichage dans la configuration courante (plus petit d'abord) ; sans rang, après les autres. */
  rank: z.number().optional(),
  /**
   * Réécriture de la forme canonique (`standby 0 ip …` → `standby ip …`) : la ligne réécrite est relue
   * comme si elle avait été saisie. `replace` accepte `$1`…
   */
  rewrite: z.object({ pattern: z.string().min(1), replace: z.string() }).optional(),
  /**
   * Entrées rangées dans une section (`access-list 10 permit …` dans `ip access-list standard 10`) :
   * la ligne, privée de ses `skip` premiers mots, y est exécutée. Sa forme `no` retire toute la section.
   */
  into: z.object({ section: z.string().min(1), skip: z.number().int().min(1) }).optional(),
  /**
   * Sections affichées à plat (ACL numérotées) : quand l'en-tête correspond à `match`, chaque ligne de la
   * section s'affiche, et se lit dans la configuration globale, sous la forme `display` + ligne
   * (`access-list $1` : groupe de `match`), au rang `rank`.
   */
  flatten: z.object({ match: z.string().min(1), display: z.string().min(1), rank: z.number().optional() }).optional(),
  /**
   * Sous-mode découpé en blocs fixes (`line vty 0 4` et `5 15`) : les deux derniers paramètres sont une
   * plage ; une plage qui couvre plusieurs blocs vise chacun, une plage partielle découpe le bloc, et des
   * morceaux voisins d'un même bloc à la configuration identique sont réunis.
   */
  blocks: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).optional(),
  /**
   * Agrégat (EtherChannel) : la commande rattache l'interface à la section `section` (`{$1}` : paramètre).
   * Les lignes qui correspondent à `lines` sont recopiées : du premier membre vers l'agrégat qu'il crée,
   * de l'agrégat vers chaque membre qui le rejoint, et de l'agrégat vers ses membres à chaque modification.
   */
  aggregate: z.object({ section: z.string().min(1), lines: z.string().min(1) }).optional(),
  /** Aide `?` propre à cette commande, par mot de la syntaxe (« access », « <1-4094> »…). */
  help: z.record(z.string()).default({}),
  /**
   * Indices (dans la forme canonique, négatifs depuis la fin) des mots qui identifient le réglage :
   * une nouvelle valeur remplace l'ancienne (`hostname`, `ip address`…). Sans clé, les lignes s'ajoutent.
   */
  key: z.array(z.number().int()).optional(),
  /** Commandes qui règlent la même chose sous des formes différentes (`username … secret` et `username … password`) : leurs clés se remplacent. */
  keyGroup: z.string().optional(),
  /**
   * Entrées numérotées (ACL nommées) : un premier paramètre numérique est un numéro de séquence.
   * Les entrées sont rangées par numéro, enregistrées sans lui (comme la configuration courante d'IOS),
   * et une entrée sans numéro prend le dernier + 10.
   */
  sequenced: z.boolean().optional(),
  /**
   * Forme `no` : `remove` retire la ligne (défaut), `store` garde « no … » (la forme positive est le
   * défaut, comme `ip domain-lookup`), `toggle` retire la forme positive ou garde « no … », `none` l'interdit.
   */
  negate: z.enum(['remove', 'store', 'toggle', 'none']).optional(),
  /** Entre dans un sous-mode ; la section porte la forme canonique de la commande. */
  enter: z.object({ mode: z.string().min(1), range: z.boolean().optional() }).optional(),
  /** Passe dans un autre mode (`enable`, `configure terminal`, `disable`). */
  goto: z.string().optional(),
  /** Remonte d'un mode (`exit`). */
  exit: z.boolean().optional(),
  /** Revient au mode de fin de configuration (`end`). */
  end: z.boolean().optional(),
  /** Variables de l'équipement modifiées : valeur littérale ou `{$1}` (premier paramètre). */
  set: z.record(z.string()).optional(),
  /** Texte affiché après la commande. Variables : `{hostname}`, `{$1}`, `{target}`. */
  output: z.string().optional(),
  /** Sortie calculée par le moteur. */
  builtin: z.enum(['running-config']).optional(),
  /** Forcer ou empêcher l'enregistrement dans la configuration (par défaut : oui en mode configuration). */
  store: z.boolean().optional(),
  /** Sections créées en même temps (`interface Port-channel{$1}` pour `channel-group`). */
  create: z.array(z.string()).optional(),
  /** Affiché quand une section de `create` n'existait pas encore. */
  createOutput: z.string().optional(),
  /** Liste d'entiers mise à jour : `set`, `add`, `remove`, `except`, `all`, `none` sur la ligne `prefix`. */
  list: z
    .object({ op: z.enum(['set', 'add', 'remove', 'except', 'all', 'none']), prefix: z.string().min(1), max: z.number().int().positive() })
    .optional(),
  requires: z.array(requirementSchema).optional(),
  /** Affichage dans la configuration, si différent de la forme canonique. `{mask:$2}` masque un secret. */
  display: z.string().optional(),
});

export const terminalModeSchema = z.object({
  id: z.string().min(1),
  /** Prompt, avec les variables de l'équipement : `{hostname}(config-if)#`. */
  prompt: z.string().min(1),
  /** Mode parent : destination de `exit`, et modes essayés quand une commande n'existe pas ici. */
  parent: z.string().optional(),
  /** Mode de configuration : `no`, `do`, `end` et Ctrl+Z y sont permis, les commandes y sont enregistrées. */
  config: z.boolean().default(false),
  /** Titre de la liste affichée par `?`. */
  helpTitle: z.string().default('Commands:'),
  /** Les sections de ce mode n'apparaissent pas dans la configuration courante (VLAN en VTP serveur…). */
  hidden: z.boolean().default(false),
  /** Message pour un mot inconnu seul en début de ligne (IOS le prend pour un nom d'hôte). */
  unknownCommand: z.string().optional(),
});

export const terminalProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    modes: z.array(terminalModeSchema).min(1),
    /** Mode de départ d'une session. */
    startMode: z.string().min(1),
    /** Mode dans lequel la configuration de départ est chargée, et où l'on revient de la racine de configuration. */
    configMode: z.string().min(1),
    /** Mode atteint par `end` et Ctrl+Z, et mode d'exécution de `do`. */
    endMode: z.string().min(1),
    /** Mot qui exécute une commande d'`endMode` depuis la configuration (`do`) ; absent pour l'interdire. */
    doKeyword: z.string().optional(),
    messages: z.object({
      invalid: z.string().min(1),
      ambiguous: z.string().min(1),
      incomplete: z.string().min(1),
      unrecognized: z.string().min(1),
      /** Affiché en sortant de la configuration (`end`, Ctrl+Z, `exit`). */
      leaveConfig: z.string().optional(),
      /** Numéro de séquence déjà pris. */
      duplicateSequence: z.string().default('% Duplicate sequence number'),
      /** Écho de Ctrl+Z. */
      ctrlZ: z.string().default('^Z'),
    }),
    runningConfig: z.object({
      header: z.string(),
      footer: z.string(),
      separator: z.string().default('!'),
      indent: z.string().default(' '),
    }),
    /** Types d'équipement : nom par défaut et lignes présentes d'office sur chaque interface physique. */
    deviceTypes: z.record(
      z.object({
        defaultHostname: z.string().min(1),
        /** Configuration présente sur tout équipement de ce type, chargée avant celle du lab. */
        baseConfig: z.string().default(''),
        /** Section d'une interface physique (`interface {name}`) et lignes qu'elle contient d'office. */
        interfaceSection: z.string().default('interface {name}'),
        interfaceDefaults: z.array(z.string()).default([]),
      }),
    ),
    interfaceTypes: z
      .array(
        z.object({
          name: z.string().regex(/^[A-Za-z][A-Za-z-]*$/),
          help: z.string().default(''),
          /** Interface logique créée à la demande (Loopback, Vlan…), numérotée dans `range`. */
          virtual: z.boolean().default(false),
          range: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
          devices: z.array(z.string()).optional(),
          /**
           * Rang d'affichage des sections de ce type : les interfaces physiques sont au rang 0 et suivent
           * l'ordre de l'équipement ; un type logique se place avant (rang négatif) ou après.
           */
          rank: z.number().default(0),
        }),
      )
      .min(1),
    /** Ports nommés acceptés à la place du numéro, par table (`tcp` : `www` = 80 ; `udp` : `tftp` = 69). */
    portNames: z.record(z.record(z.number().int().min(0).max(65535))).default({}),
    /** Aide `?` des mots-clés, par défaut pour tous les modes. */
    keywordHelp: z.record(z.string()).default({}),
    /** Aide `?` des types de paramètres. */
    paramHelp: z.record(z.string()).default({}),
    commands: z.array(terminalCommandSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const ids = new Set(p.modes.map((m) => m.id));
    if (ids.size !== p.modes.length) ctx.addIssue({ code: 'custom', message: 'mode en double' });
    const known = (id: string | undefined, where: string) => {
      if (id !== undefined && !ids.has(id)) ctx.addIssue({ code: 'custom', message: `${where} : mode inconnu ${id}` });
    };
    known(p.startMode, 'startMode');
    known(p.configMode, 'configMode');
    known(p.endMode, 'endMode');
    for (const m of p.modes) known(m.parent, `parent de ${m.id}`);
    for (const c of p.commands) {
      for (const m of c.modes) known(m, c.syntax);
      known(c.enter?.mode, c.syntax);
      known(c.goto, c.syntax);
      for (const d of c.devices ?? []) {
        if (!p.deviceTypes[d]) ctx.addIssue({ code: 'custom', message: `${c.syntax} : type d'équipement inconnu ${d}` });
      }
      for (const [d, types] of Object.entries(c.onInterfaces ?? {})) {
        if (d !== '*' && !p.deviceTypes[d]) ctx.addIssue({ code: 'custom', message: `${c.syntax} : type d'équipement inconnu ${d}` });
        for (const t of types) {
          if (!p.interfaceTypes.some((x) => x.name === t)) ctx.addIssue({ code: 'custom', message: `${c.syntax} : type d'interface inconnu ${t}` });
        }
      }
      if (c.blocks && !c.enter) ctx.addIssue({ code: 'custom', message: `${c.syntax} : blocks sans enter` });
    }
  });

export type TerminalProfile = z.infer<typeof terminalProfileSchema>;
export type TerminalProfileInput = z.input<typeof terminalProfileSchema>;
export type TerminalCommand = z.infer<typeof terminalCommandSchema>;
export type TerminalMode = z.infer<typeof terminalModeSchema>;

export function parseTerminalProfile(input: unknown): TerminalProfile {
  return terminalProfileSchema.parse(input);
}
