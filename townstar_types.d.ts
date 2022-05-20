interface IPosition { x: number, y: number }

declare class TS_Game {
    IsTownViewActive(): boolean;
    IsWorldViewActive(): boolean;
    OnConnection(): void;
    OnLostConnection(): void;
    addPoints(t: number): void;
    addCurrency(t: number): void;
    addGold(t: number): void;
    removeObject(t: string, e: number): void;
    addObject(t: string, e: number, i: number): void;
    tradeCraftsToCity(t: string, e: number, i: number, n: number): void;
    updateGameSelf(): any;
    saveTown(): any;
    saveAll(): any;
    Nuke(): void;
    Update(t: number): void;
}

declare class TS_ObjectLogic {
    SetActive(state: boolean): void;
    SetCraft(craftType: string): void;
    GetState(): void;
    data: {
        active: boolean;
        craft: string;
        state: string;
    }
}

declare class TS_Object {
    type: string;
    townX: number;
    townZ: number;
    worldX: number;
    worldZ: number;
    craftEntity: {
        name: string;
    }
    entity: {
        position: IPosition;
    }
    logicObject: TS_ObjectLogic;
    data: {
        reqList: { [name: string]: number };
        state: "WaitForReqs" | "WaitForUnits" | "Produce" | "Complete"
    }
    objData: IObjectData;
}

declare class TS_ConstructionSiteLogic extends TS_ObjectLogic {
    SpawnNotifEntity(t: number): void;
    OnTapped(): void;
    CompleteBuild(): void;
}

declare class TS_StorageObjectLogic extends TS_ObjectLogic {
    AddCraft(t: string, e: number): boolean;
    RemoveCraft(t: string, e: number): boolean;
}

declare class TS_CrafterObjectLogic extends TS_ObjectLogic {
    AddCraft(t: string, e: number): boolean; // (this adds required items needed for crafting)
    RemoveCraft(t: string, e: number): boolean; // (this "harvests" the item)
    SetState(t: "Idle" | "WaitForReqs" | "WaitForUnits" | "Produce" | "Complete") : any;
}

interface ICraftData {
    CityPoints: number;
    CityPrice: number;
    Class: "Crafted"
    CraftingText: string;
    Id: number;
    Name: string;
    OnDestroy: string;
    ProximityBonus: "None" | string; // (this item that gives it a buff, such as "Water")
    ProximityPenalty: "None" | string; // (this item that gives it a debuff, such as "Dirty,Shady,Salty")
    ProximityReverse: boolean;
    Req1: string; // (first required item)
    Req2: string; // (second required item)
    Req3: string; // (third required item)
    Time0: number;
    Time1: number;
    Time2: number;
    Time3: number;
    Type: "Chosen" | "Auto";
    Value1: number; // (first required item amount)
    Value2: number; // (second required item amount)
    Value3: number; // (third required item amount)
}

interface IObjectData {
    BlockChainID: string; //"None"
    BuildCost: string; //50000
    CanBuildUpon: boolean; //false
    CanSelectCraft: boolean; //true
    Capacity: number; //1
    Class: string; //"Industrial"
    Construction: string; //"Construction_Wood_5"
    CraftReqsMet: boolean; //false
    CraftTimeMod: number; //1
    Crafts: string; //"Lumber,Oak_Barrel"
    Description: string; //"Turn_those_logs_of_wood_into_Grade_A_building_material_using_a_Lumber_Mill."
    DestroyCost: number; //37500
    Destroyable: boolean; //true
    EdgeClass: string; //"Building"
    EdgeRequirements: string; //"Road"
    GoldCost: number; //25
    HasDynamicGround: boolean; //true
    Id: number; //1029
    InStore: boolean; //true
    InputDeliver: string; //"Home"
    InputPickup: string; //"(Wood_Shed,Lumber_Yard),Warehouse"
    LaborCost: number; //50
    Name: string; //"Lumber_Mill"
    OutputDeliver: string; //"(Wood_Shed,Lumber_Yard),Warehouse"
    OutputPickup: string; //"Home"
    PathBase: string; //"500,.25"
    PathMask: string; //"1000,.5"
    PathMaskType: string; //"Building"
    ProximityDist: number; //2
    ProximityEmit: string; //"Shady"
    ProximityImmune: boolean; //true
    QuestId: string; //"None"
    Rotatable: boolean; //true
    RotateTo: string; //"Road"
    StorageType: string; //"ActiveCrafter"
    TileWith: string; //"None"
    UTValue: number; //1
    UnitType: string; //"Millworker"
}

interface ITownInfo {
    userId: string;
    name: string;
    profilePhotoUrl: string;
    x: number;
    y: number;
}

interface ITradeData {
    userId: string;
    duration: 38000,
    unitType: string; // ("Truck")
    craftType: string; // ("Wood")
    source: { x: number; z: number; };
    startTime: string; // (ISO: "2021-05-14T07:45:00.217Z")
    path?: { x: number; z: number; }[];
}

interface IIncomingTownData {
    [index: number]: ITradeData;
}

interface ILeaderBoardEntry {
    name: string;
    profilePhotoUrl: string;
    rank: number;
    score: number;
    userId: string;
}

interface IGameData {
    active: true
    duration: number; //2674800
    end: string; //"2021-07-01T15:00:00.000Z"
    gameId: string; //"free"
    name: string; //"Free"
    next: {
        active: string; //false
        duration: number; //2674800
        end: string; //"2021-08-01T15:00:00.000Z"
        gameId: string; //"free"
        name: string; //"Free"
        secondsRemaining: number; //5118482.971
        serverTime: string; //"2021-06-03T09:11:57.029Z"
        start: string; //"2021-07-01T16:00:00.000Z"
    }
    population: number; //1475
    secondsRemaining: number; //2440082.971
    serverTime: string; //"2021-06-03T09:11:57.029Z"
    start: string; //"2021-05-31T16:00:00.000Z"
}

declare namespace RT {
    export function view(range: { from: { x: number, z: number }, to: { x: number, z: number } }): void;
}

declare namespace Game {
    export var userId: string;
    export var playerName: string;
    export var townName: string;
    export var currency: number;
    export var app: {
        root: {
            findByName(name: string): any;
        }
        fire(name: string): void;
        systems: { camera: { cameras: any[] } }
        timeScale: number;
        on: (eventName: string, callback: Function) => void;
        off: (callback: Function) => void;
    };
    export var world: {
        towns: { [loc: string]: ITownInfo }
    }
    export var town: {
        objectDict: { [index: string]: TS_Object };
        laborTick: number;
        laborPaid: boolean;
        offsetX: number;
        offsetZ: number;
        worldType: string;
        defaultObjectType: string; // (eg "Grass")
        GetActiveTradeData(pos: {
            x: number;
            z: number;
        }): any;
        FindObjectsOfType(type: string): TS_Object;
        GetStoredCrafts(): { [index: string]: number };
        GetTotalLaborCost(): number;
    };
    export var objectData: { [index: string]: IObjectData }
    export var craftData: { [index: string]: ICraftData }
    export var gameData: IGameData;
    export var OnLostConnection: Function;
}

interface ITownTransaction {
    town: ITownInfo;
    trade: ITradeData;
}

interface IGameUpdates {
    userId: string; // (ID of the user sending the update)
    transactions: ITownTransaction[];
    leaders: ILeaderBoardEntry[];
    craftData: typeof Game.craftData;
    objectData: typeof Game.objectData;
    gameData: IGameData;
}

interface ISavedTownData {
    objectDic: IndexedObject<IObjectData>, // (less data to end if we send only what this town has and not store with every tile)
    data: {
        data: typeof TS_Object.prototype.data;
        logicData: typeof TS_ObjectLogic.prototype.data;
        townX: number;
        townZ: number;
        worldX: number;
        worldZ: number;
        type: string;
    }[],
    worldType: string;
    defaultObjectType: string;
    offsetX: number;
    offsetY: number;
    savedOn: number;
}

