import {Empire} from "../Empire";
import {Mission} from "../missions/Mission";
import {SpawnGroup} from "../SpawnGroup";
import {OperationPriority} from "../../config/constants";
import {Profiler} from "../../Profiler";
import {empire} from "../../helpers/loopHelper";
import {RoomHelper} from "../RoomHelper";

export abstract class Operation {

    flag: Flag;
    name: string;
    type: string;
    room: Room;
    memory: any;
    priority: OperationPriority;
    hasVision: boolean;
    sources: Source[];
    mineral: Mineral;
    spawnGroup: SpawnGroup;
    missions: {[roleName: string]: Mission};
    waypoints: Flag[];

    /**
     *
     * @param flag - missions will operate relative to this flag, use the following naming convention: "operationType_operationName"
     * @param name - second part of flag.name, should be unique amont all other operation names (I use city names)
     * @param type - first part of flag.name, used to determine which operation class to instantiate
     * @param empire - object used for empire-scoped behavior (terminal transmission, etc.)
     */
    constructor(flag: Flag, name: string, type: string) {
        this.flag = flag;
        this.name = name;
        this.type = type;
        this.room = flag.room;
        this.memory = flag.memory;
        if (!this.missions) { this.missions = {}; }
        // variables that require vision (null check where appropriate)
        if (this.flag.room) {
            this.hasVision = true;
            this.sources = _.sortBy(flag.room.find<Source>(FIND_SOURCES), (s: Source) => s.pos.getRangeTo(flag));
            this.mineral = _.head(flag.room.find<Mineral>(FIND_MINERALS));
        }
    }


    /**
     * Init Phase - initialize operation variables and instantiate missions
     */
    init() {
        try {
            this.initOperation();
        }
        catch (e) {
            console.log("error caught in initOperation phase, operation:", this.name);
            console.log(e.stack);
        }

        for (let missionName in this.missions) {
            try {
                Profiler.start("in_m." + missionName.substr(0, 3));
                this.missions[missionName].initMission();
                Profiler.end("in_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in initMission phase, operation:", this.name, "mission:", missionName);
                console.log(e.stack);
            }
        }
    }
    abstract initOperation();

    /**
     * RoleCall Phase - Iterate through missions and call mission.roleCall()
     */
    roleCall() {
        // mission roleCall
        for (let missionName in this.missions) {
            try {
                Profiler.start("rc_m." + missionName.substr(0, 3));
                this.missions[missionName].roleCall();
                Profiler.end("rc_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in roleCall phase, operation:", this.name, "mission:", missionName);
                console.log(e.stack);
            }
        }
    }

    /**
     * Action Phase - Iterate through missions and call mission.missionActions()
     */
    actions() {
        // mission actions
        for (let missionName in this.missions) {
            try {
                Profiler.start("ac_m." + missionName.substr(0, 3));
                this.missions[missionName].missionActions();
                Profiler.end("ac_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in missionActions phase, operation:", this.name, "mission:", missionName, "in missionRoom ", this.flag.pos.roomName);
                console.log(e.stack);
            }
        }
    }

    /**
     * Finalization Phase - Iterate through missions and call mission.finalizeMission(), also call operation.finalizeOperation()
     */
    finalize() {
        // mission actions
        for (let missionName in this.missions) {
            try {
                Profiler.start("fi_m." + missionName.substr(0, 3));
                this.missions[missionName].finalizeMission();
                Profiler.end("fi_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in finalizeMission phase, operation:", this.name, "mission:", missionName);
                console.log(e.stack);
            }
        }

        try {
            this.finalizeOperation();
        }
        catch (e) {
            console.log("error caught in finalizeOperation phase, operation:", this.name);
            console.log(e.stack);
        }
    }
    abstract finalizeOperation();

    /**
     * Invalidate Cache Phase - Occurs every-so-often (see constants.ts) to give you an efficient means of invalidating operation and
     * mission cache
     */
    invalidateCache() {
        // base rate of 1 proc out of 100 ticks
        if (Math.random() < .01) {
            for (let missionName in this.missions) {
                try {
                    this.missions[missionName].invalidateMissionCache();
                }
                catch (e) {
                    console.log("error caught in invalidateMissionCache phase, operation:", this.name, "mission:", missionName);
                    console.log(e.stack);
                }
            }

            try {
                this.invalidateOperationCache();
            }
            catch (e) {
                console.log("error caught in invalidateOperationCache phase, operation:", this.name);
                console.log(e.stack);
            }
        }
    }
    abstract invalidateOperationCache();

    /**
     * Add mission to operation.missions hash
     * @param mission
     */
    addMission(mission: Mission) {
        // it is important for every mission belonging to an operation to have
        // a unique name or they will be overwritten here
        this.missions[mission.name] = mission;
    }

    getRemoteSpawnGroup(distanceLimit = 4, levelRequirement = 1): SpawnGroup {

        // invalidated periodically
        if (!this.memory.nextSpawnCheck || Game.time >= this.memory.nextSpawnCheck) {
            let spawnGroups = _.filter(_.toArray(empire.spawnGroups),
                spawnGroup => spawnGroup.room.controller.level >= levelRequirement
                && spawnGroup.room.name !== this.flag.pos.roomName);
            let bestGroups = RoomHelper.findClosest(this.flag, spawnGroups,
                {margin: 50, linearDistanceLimit: distanceLimit});

            let roomNames = _(bestGroups)
                .sortBy(value => value.distance)
                .map(value => value.destination.pos.roomName)
                .value();
            if (roomNames.length > 0) {
                this.memory.spawnRooms = roomNames;
                this.memory.nextSpawnCheck = Game.time + 10000; // Around 10 hours
            } else {
                this.memory.nextSpawnCheck = Game.time + 1000; // Around 1 hour
            }
            console.log(`SPAWN: finding spawn rooms in ${this.name}, result: ${roomNames}`);
        }

        if (this.memory.spawnRooms) {
            let bestAvailability = 0;
            let bestSpawnGroup;
            for (let roomName of this.memory.spawnRooms) {
                let spawnGroup = empire.getSpawnGroup(roomName);
                if (!spawnGroup) { continue; }
                if (spawnGroup.averageAvailability >= 1) { return spawnGroup; }
                if (spawnGroup.averageAvailability > bestAvailability) {
                    bestAvailability = spawnGroup.averageAvailability;
                    bestSpawnGroup = spawnGroup;
                }
            }
            return bestSpawnGroup;
        }

        this.memory.nextSpawnCheck = Math.max(this.memory.nextSpawnCheck, Game.time + 100); // Around 6 min
    }

    manualControllerBattery(id: string) {
        let object = Game.getObjectById(id);
        if (!object) { return "that is not a valid game object or not in vision"; }
        this.flag.room.memory.controllerBatteryId = id;
        this.flag.room.memory.upgraderPositions = undefined;
        return "controller battery assigned to" + object;
    }

    protected findOperationWaypoints() {
        this.waypoints = [];
        for (let i = 0; i < 100; i++) {
            let flag = Game.flags[this.name + "_waypoints_" + i];
            if (flag) {
                this.waypoints.push(flag);
            }
            else {
                break;
            }
        }
    }

    setSpawnRoom(roomName: string | Operation, portalTravel = false) {

        if (roomName instanceof Operation) {
            roomName = roomName.flag.room.name;
        }

        if (!empire.getSpawnGroup(roomName)) {
            return "SPAWN: that missionRoom doesn't appear to host a valid spawnGroup";
        }

        if (!this.waypoints || !this.waypoints[0]) {
            if (portalTravel) {
                return "SPAWN: please set up waypoints before setting spawn missionRoom with portal travel";
            }
        }
        else {
            this.waypoints[0].memory.portalTravel = portalTravel;
        }

        this.memory.spawnRoom = roomName;
        _.each(this.missions, (mission) => mission.invalidateSpawnDistance());
        return "SPAWN: spawnRoom for " + this.name + " set to " + roomName + " (map range: " +
            Game.map.getRoomLinearDistance(this.flag.pos.roomName, roomName) + ")";
    }

    setMax(missionName: string, max: number) {
        if (!this.memory[missionName]) return "SPAWN: no " + missionName + " mission in " + this.name;
        let oldValue = this.memory[missionName].max;
        this.memory[missionName].max = max;
        return "SPAWN: " + missionName + " max spawn value changed from " + oldValue + " to " + max;
    }

    setBoost(missionName: string, activateBoost: boolean) {
        if (!this.memory[missionName]) return "SPAWN: no " + missionName + " mission in " + this.name;
        let oldValue = this.memory[missionName].activateBoost;
        this.memory[missionName].activateBoost = activateBoost;
        return "SPAWN: " + missionName + " boost value changed from " + oldValue + " to " + activateBoost;
    }

    repair(id: string, hits: number) {
        if (!id || !hits) return "usage: opName.repair(id, hits)";
        if (!this.memory.mason) return "no mason available for repair instructions";
        let object = Game.getObjectById(id);
        if (!object) return "that object doesn't seem to exist";
        if (!(object instanceof Structure)) return "that isn't a structure";
        if (hits > object.hitsMax) return object.structureType + " cannot have more than " + object.hitsMax + " hits";
        this.memory.mason.manualTargetId = id;
        this.memory.mason.manualTargetHits = hits;
        return "MASON: repairing " + object.structureType + " to " + hits + " hits";
    }
}