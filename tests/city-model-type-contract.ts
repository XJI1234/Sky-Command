import { CityModelCatalog, type CityModelDescriptor, type CityModelRegistration } from "../src/modules/geo-map/city-model/index.js";

const registration: CityModelRegistration = { id: "hangzhou-white-model", displayName: "杭州建筑白模", tilesetUrl: "/hangzhou-3dtiles/tileset.json" };
const created = CityModelCatalog.create([registration]);
declare const descriptor: CityModelDescriptor;

// @ts-expect-error A descriptor format is fixed to the 3D Tiles resource type.
descriptor.format = "glb";
// @ts-expect-error Registrations require a local tileset URL string.
const invalidRegistration: CityModelRegistration = { id: "model", displayName: "模型", tilesetUrl: null };

void created;
void invalidRegistration;
