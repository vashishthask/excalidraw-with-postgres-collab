import { ExcalidrawElement, FileId } from "../../src/element/types";
import { getSceneVersion } from "../../src/element";
import Portal from "../collab/Portal";
import { restoreElements } from "../../src/data/restore";
import {
    AppState,
} from "../../src/types";
import { reconcileElements } from "../collab/reconciliation";
import { getSyncableElements, SyncableExcalidrawElement } from ".";

interface PostgresStoredScene {
    sceneVersion: number;
    jsonText: string;
}

const elementsToJson = async (
    elements: readonly ExcalidrawElement[],
): Promise<{ jsonElements: string }> => {
    const json = JSON.stringify(elements);
    return { jsonElements: json };
};


class SceneVersionCache {
    private static cache = new WeakMap<SocketIOClient.Socket, number>();
    static get = (socket: SocketIOClient.Socket) => {
        return SceneVersionCache.cache.get(socket);
    };
    static set = (
        socket: SocketIOClient.Socket,
        elements: readonly SyncableExcalidrawElement[],
    ) => {
        SceneVersionCache.cache.set(socket, getSceneVersion(elements));
    };
}

export const isPersisted = (
    portal: Portal,
    elements: readonly ExcalidrawElement[],
): boolean => {
    if (portal.socket && portal.roomId && portal.roomKey) {
        const sceneVersion = getSceneVersion(elements);

        return SceneVersionCache.get(portal.socket) === sceneVersion;
    }
    // if no room exists, consider the room saved so that we don't unnecessarily
    // prevent unload (there's nothing we could do at that point anyway)
    return true;
};



const createSceneDocument = async (
    elements: readonly SyncableExcalidrawElement[],
) => {
    const sceneVersion = getSceneVersion(elements);
    const { jsonElements } = await elementsToJson(elements);
    return {
        sceneVersion,
        jsonText: jsonElements,
    } as PostgresStoredScene;
};

export const saveToPostgres = async (
    portal: Portal,
    elements: readonly SyncableExcalidrawElement[],
    appState: AppState,
) => {
    const { roomId, roomKey, socket } = portal;
    if (!roomId || !roomKey || !socket || isPersisted(portal, elements)) {
        return false;
    }

    const savedData = await (async function () {

        let prevElements = await getElementsFromPostgres(roomId);
        if (!prevElements) {
            const sceneDocument = await createSceneDocument( //PostgresStoredScene
                elements,
            );
            console.log("The data to be saved is:", sceneDocument);
            const response = await fetch('http://localhost:9030/excalistore/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ roomId, data: sceneDocument }),
            });
            console.log("the response code is:", response.status);
            if (response.status == 200) {
                return {
                    elements,
                    reconciledElements: null,
                };
            } else {
                return {
                    elements,
                    reconciledElements: null,
                };
            }
        } else {
            console.log("The prevElements.jsonText:", prevElements.jsonText);
            const parsedElements: ExcalidrawElement[] = JSON.parse(prevElements.jsonText);

            prevElements = getSyncableElements(parsedElements);
            const reconciledElements = getSyncableElements(reconcileElements(elements, prevElements, appState));
            const sceneDocument = await createSceneDocument(reconciledElements);
            console.log("The data to be saved is:", sceneDocument);
            const response = await fetch('http://localhost:9030/excalistore/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ roomId, data: sceneDocument }),
            });
            if (response.status != 200) {
                throw new Error('Network response was not ok');
            } else {
                return { elements, reconciledElements };
            }
        }
    })();

    SceneVersionCache.set(socket, savedData.elements);
    return { reconciledElements: savedData.reconciledElements };;
};

const getElementsFromPostgres = async (
    roomId: string
) => {
    const response = await fetch(`http://localhost:9030/excalistore/${roomId}/`);
    console.log("the response status is:", response.status);
    if (response.status == 404 || !response.ok) {
        return null;
    }
    return await response.json();
};

export const loadFromPostgres = async (
    roomId: string,
    socket: SocketIOClient.Socket | null,
) => {
    const storedScene = await getElementsFromPostgres(roomId);
    const parsedElements: ExcalidrawElement[] = JSON.parse(storedScene.jsonText);
    const elements = getSyncableElements(parsedElements);

    if (socket) {
        SceneVersionCache.set(socket, elements);
    }

    return restoreElements(elements, null);
};

export const saveFilesToServer = async ({
    prefix,
    files,
}: {
    prefix: string;
    files: { id: FileId; buffer: Uint8Array }[];
}) => {
    const erroredFiles = new Map<FileId, true>();
    const savedFiles = new Map<FileId, true>();

    await Promise.all(
        files.map(async ({ id, buffer }) => {
            try {
                const formData = new FormData();
                formData.append('file', new Blob([buffer]));

                await fetch('http://localhost:9030/api/upload/', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });

                savedFiles.set(id, true);
            } catch (error) {
                erroredFiles.set(id, true);
            }
        }),
    );

    return { savedFiles, erroredFiles };
};