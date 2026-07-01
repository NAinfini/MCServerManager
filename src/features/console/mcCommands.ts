export interface McCommand {
  command: string;
  description: string;
  usage?: string;
}

export const MC_COMMANDS: McCommand[] = [
  {
    command: "advancement",
    description: "Give, remove, or check player advancements.",
    usage: "advancement (grant|revoke) <targets> <advancement>",
  },
  {
    command: "attribute",
    description: "Query or modify entity attributes.",
    usage: "attribute <target> <attribute> <get|base|modifier>",
  },
  {
    command: "ban",
    description: "Add a player to the server blacklist.",
    usage: "ban <targets> [reason]",
  },
  {
    command: "ban-ip",
    description: "Add an IP address to the server blacklist.",
    usage: "ban-ip <target> [reason]",
  },
  {
    command: "banlist",
    description: "Show the list of banned players or IP addresses.",
    usage: "banlist [ips|players]",
  },
  {
    command: "bossbar",
    description: "Create and modify boss bars.",
    usage: "bossbar (add|remove|list|set|get) ...",
  },
  {
    command: "clear",
    description: "Clear items from player inventory.",
    usage: "clear [targets] [item] [maxCount]",
  },
  {
    command: "clone",
    description: "Copy blocks from one region to another.",
    usage: "clone <begin> <end> <destination>",
  },
  {
    command: "damage",
    description: "Deal damage to entities.",
    usage: "damage <target> <amount> [type]",
  },
  {
    command: "data",
    description: "Get, merge, modify, and remove block, entity, and storage data.",
    usage: "data (get|merge|modify|remove) ...",
  },
  {
    command: "datapack",
    description: "Control loaded data packs.",
    usage: "datapack (enable|disable|list) ...",
  },
  {
    command: "debug",
    description: "Start, stop, or view server debug profiling.",
    usage: "debug (start|stop|function) ...",
  },
  {
    command: "defaultgamemode",
    description: "Set the default game mode for new players.",
    usage: "defaultgamemode <mode>",
  },
  {
    command: "deop",
    description: "Revoke operator status from a player.",
    usage: "deop <targets>",
  },
  {
    command: "difficulty",
    description: "Set or query the game difficulty.",
    usage: "difficulty [peaceful|easy|normal|hard]",
  },
  {
    command: "effect",
    description: "Add or remove status effects.",
    usage: "effect (give|clear) <targets> [effect]",
  },
  {
    command: "enchant",
    description: "Add an enchantment to a player's selected item.",
    usage: "enchant <targets> <enchantment> [level]",
  },
  {
    command: "execute",
    description: "Execute another command with modified context.",
    usage: "execute <subcommands> run <command>",
  },
  {
    command: "experience",
    description: "Add or remove player experience.",
    usage: "experience (add|set|query) <targets> <amount> [levels|points]",
  },
  {
    command: "xp",
    description: "Alias for /experience.",
    usage: "xp (add|set|query) <targets> <amount> [levels|points]",
  },
  {
    command: "fill",
    description: "Fill a region with a specific block.",
    usage: "fill <from> <to> <block>",
  },
  {
    command: "fillbiome",
    description: "Fill a region with a specific biome.",
    usage: "fillbiome <from> <to> <biome>",
  },
  {
    command: "forceload",
    description: "Force chunks to be constantly loaded.",
    usage: "forceload (add|remove|query) <from> [to]",
  },
  {
    command: "function",
    description: "Run a function.",
    usage: "function <name>",
  },
  {
    command: "gamemode",
    description: "Set a player's game mode.",
    usage: "gamemode <mode> [target]",
  },
  {
    command: "gamerule",
    description: "Set or query a game rule value.",
    usage: "gamerule <rule> [value]",
  },
  {
    command: "give",
    description: "Give an item to a player.",
    usage: "give <target> <item> [count]",
  },
  {
    command: "help",
    description: "List available commands or show help for a command.",
    usage: "help [command]",
  },
  {
    command: "item",
    description: "Manipulate items in inventories.",
    usage: "item (replace|modify) ...",
  },
  {
    command: "jfr",
    description: "Start or stop a Java Flight Recorder profiling session.",
    usage: "jfr (start|stop)",
  },
  {
    command: "kick",
    description: "Remove a player from the server.",
    usage: "kick <targets> [reason]",
  },
  {
    command: "kill",
    description: "Kill entities.",
    usage: "kill [targets]",
  },
  {
    command: "list",
    description: "List players currently on the server.",
    usage: "list [uuids]",
  },
  {
    command: "locate",
    description: "Locate the closest structure, biome, or point of interest.",
    usage: "locate (structure|biome|poi) <type>",
  },
  {
    command: "loot",
    description: "Drop items from a loot table.",
    usage: "loot (spawn|give|insert|replace) ...",
  },
  {
    command: "me",
    description: "Broadcast a message about yourself.",
    usage: "me <action>",
  },
  {
    command: "msg",
    description: "Send a private message to one or more players.",
    usage: "msg <targets> <message>",
  },
  {
    command: "tell",
    description: "Alias for /msg.",
    usage: "tell <targets> <message>",
  },
  {
    command: "w",
    description: "Alias for /msg.",
    usage: "w <targets> <message>",
  },
  {
    command: "op",
    description: "Grant operator status to a player.",
    usage: "op <targets>",
  },
  {
    command: "pardon",
    description: "Remove a player from the blacklist.",
    usage: "pardon <targets>",
  },
  {
    command: "pardon-ip",
    description: "Remove an IP address from the blacklist.",
    usage: "pardon-ip <target>",
  },
  {
    command: "particle",
    description: "Create particles.",
    usage: "particle <name> [position]",
  },
  {
    command: "perf",
    description: "Capture performance profiling data.",
    usage: "perf (start|stop)",
  },
  {
    command: "place",
    description: "Place a configured structure, feature, jigsaw, or template.",
    usage: "place (feature|jigsaw|structure|template) ...",
  },
  {
    command: "playsound",
    description: "Play a sound to one or more players.",
    usage: "playsound <sound> <source> <targets>",
  },
  {
    command: "recipe",
    description: "Give or take player recipes.",
    usage: "recipe (give|take) <targets> <recipe>",
  },
  {
    command: "reload",
    description: "Reload data packs, loot tables, advancements, and functions.",
    usage: "reload",
  },
  {
    command: "return",
    description: "Set the return value of a function.",
    usage: "return <value>",
  },
  {
    command: "ride",
    description: "Make entities ride other entities.",
    usage: "ride <target> (mount|dismount) ...",
  },
  {
    command: "say",
    description: "Broadcast a message to all players.",
    usage: "say <message>",
  },
  {
    command: "schedule",
    description: "Delay the execution of a function.",
    usage: "schedule (function|clear) ...",
  },
  {
    command: "scoreboard",
    description: "Manage scoreboard objectives and players.",
    usage: "scoreboard (objectives|players) ...",
  },
  {
    command: "seed",
    description: "Display the world seed.",
    usage: "seed",
  },
  {
    command: "setblock",
    description: "Change a block to another block.",
    usage: "setblock <position> <block>",
  },
  {
    command: "setidletimeout",
    description: "Set the time before idle players are kicked.",
    usage: "setidletimeout <minutes>",
  },
  {
    command: "setworldspawn",
    description: "Set the world spawn location.",
    usage: "setworldspawn [position]",
  },
  {
    command: "spawnpoint",
    description: "Set the spawn point for a player.",
    usage: "spawnpoint [targets] [position]",
  },
  {
    command: "spectate",
    description: "Make one player spectate another entity.",
    usage: "spectate [target] [player]",
  },
  {
    command: "spreadplayers",
    description: "Teleport entities to random locations.",
    usage: "spreadplayers <center> <spreadDistance> <maxRange> <respectTeams> <targets>",
  },
  {
    command: "stop",
    description: "Stop the server.",
    usage: "stop",
  },
  {
    command: "stopsound",
    description: "Stop a sound from playing.",
    usage: "stopsound <targets> [source] [sound]",
  },
  {
    command: "summon",
    description: "Summon an entity.",
    usage: "summon <entity> [position]",
  },
  {
    command: "tag",
    description: "Add or remove entity tags.",
    usage: "tag <targets> (add|remove|list) [name]",
  },
  {
    command: "team",
    description: "Manage teams.",
    usage: "team (add|remove|list|join|leave|modify) ...",
  },
  {
    command: "teammsg",
    description: "Send a message to your team.",
    usage: "teammsg <message>",
  },
  {
    command: "teleport",
    description: "Teleport entities.",
    usage: "teleport <destination>",
  },
  {
    command: "tp",
    description: "Alias for /teleport.",
    usage: "tp <destination>",
  },
  {
    command: "tellraw",
    description: "Display a JSON message to players.",
    usage: "tellraw <targets> <message>",
  },
  {
    command: "tick",
    description: "Control the game tick rate and behavior.",
    usage: "tick (query|rate|sprint|step|unfreeze|freeze) ...",
  },
  {
    command: "time",
    description: "Change or query the world's game time.",
    usage: "time (set|add|query) <value>",
  },
  {
    command: "title",
    description: "Manage screen titles for players.",
    usage: "title <targets> (clear|reset|title|subtitle|actionbar|times) ...",
  },
  {
    command: "tm",
    description: "Alias for /teammsg.",
    usage: "tm <message>",
  },
  {
    command: "trigger",
    description: "Set a scoreboard trigger.",
    usage: "trigger <objective> [add|set] [value]",
  },
  {
    command: "weather",
    description: "Set the weather.",
    usage: "weather (clear|rain|thunder) [duration]",
  },
  {
    command: "whitelist",
    description: "Manage the server whitelist.",
    usage: "whitelist (on|off|list|add|remove|reload)",
  },
  {
    command: "worldborder",
    description: "Manage the world border.",
    usage: "worldborder (add|set|center|damage|get|warning) ...",
  },
];
