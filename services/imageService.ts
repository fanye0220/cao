import { get, set, del } from 'idb-keyval';

export const saveImage = async (id: string, blob: Blob): Promise<void> => {
  await set(`char_image_${id}`, blob);
};

export const loadImage = async (id: string): Promise<Blob | undefined> => {
  return await get(`char_image_${id}`);
};

export const deleteImage = async (id: string): Promise<void> => {
  await del(`char_image_${id}`);
};
