import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  Map,
  OfflineManager,
  UserLocation,
  type CameraRef,
  type LngLatBounds,
  type MapRef,
  type OfflinePack,
  type OfflinePackStatus,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { File, Paths } from 'expo-file-system';
import { buildTrailStyle } from './trailStyle';

// สไตล์แผนที่เดินป่าของเรา เขียนเป็นไฟล์ในเครื่อง เพื่อให้เปิดแผนที่ได้แม้ไม่มีสัญญาณ
function writeStyleFile(): string {
  const file = new File(Paths.document, 'trail-style.json');
  file.create({ overwrite: true });
  file.write(JSON.stringify(buildTrailStyle()));
  return file.uri;
}

// ระดับซูมที่จะดาวน์โหลด: 10 = ภาพรวมภูมิภาค, 15 = เห็นทางเดินและอาคารชัดเจน
const MIN_ZOOM = 10;
const MAX_ZOOM = 15;

// จำกัดจำนวนไทล์ต่อการดาวน์โหลดหนึ่งครั้ง กันเลือกพื้นที่ใหญ่เกินไป
const MAX_TILES_PER_PACK = 20000;

// เริ่มต้นที่ประเทศไทย (กลางประเทศ) ก่อนได้ตำแหน่ง GPS
const THAILAND_CENTER: [number, number] = [100.9925, 15.87];

type SavedArea = {
  id: string;
  name: string;
  bounds: LngLatBounds;
  status?: OfflinePackStatus;
};

function lngToTileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}

// ประมาณจำนวนไทล์ทั้งหมดของพื้นที่ในทุกระดับซูม
function estimateTiles(bounds: LngLatBounds): number {
  const [west, south, east, north] = bounds;
  let total = 0;
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const x = lngToTileX(east, z) - lngToTileX(west, z) + 1;
    const y = latToTileY(south, z) - latToTileY(north, z) + 1;
    total += Math.max(1, x) * Math.max(1, y);
  }
  return total;
}

function formatMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `พื้นที่ ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  const [styleUri, setStyleUri] = useState<string | null>(null);
  const [altitude, setAltitude] = useState<number | null>(null);
  const [hasLocation, setHasLocation] = useState(false);
  const [following, setFollowing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [areas, setAreas] = useState<SavedArea[]>([]);
  const [listOpen, setListOpen] = useState(false);

  // กันหน้าจอดับระหว่างดาวน์โหลด
  useKeepAwake();

  const refreshAreas = useCallback(async () => {
    const packs: OfflinePack[] = await OfflineManager.getPacks();
    const items = await Promise.all(
      packs.map(async (p) => ({
        id: p.id,
        name: String(p.metadata?.name ?? 'แผนที่ไม่มีชื่อ'),
        bounds: p.bounds,
        status: await p.status().catch(() => undefined),
      })),
    );
    setAreas(items);
  }, []);

  useEffect(() => {
    try {
      setStyleUri(writeStyleFile());
    } catch (e) {
      Alert.alert('เปิดสไตล์แผนที่ไม่ได้', String(e));
    }
  }, []);

  // แสดงความสูงจาก GPS (ใช้ได้แม้ไม่มีอินเทอร์เน็ต)
  useEffect(() => {
    if (!hasLocation) return;
    let sub: Location.LocationSubscription | undefined;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 5 },
      (loc) => setAltitude(loc.coords.altitude),
    )
      .then((s) => (sub = s))
      .catch(() => {});
    return () => sub?.remove();
  }, [hasLocation]);

  useEffect(() => {
    OfflineManager.setTileCountLimit(MAX_TILES_PER_PACK + 2000);
    refreshAreas().catch(() => {});
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => setHasLocation(status === 'granted'))
      .catch(() => {});
  }, [refreshAreas]);

  const goToMe = useCallback(async () => {
    if (!hasLocation) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'ยังไม่ได้อนุญาตตำแหน่ง',
          'กรุณาเปิดสิทธิ์ตำแหน่งในการตั้งค่าเครื่อง แล้วลองใหม่',
        );
        return;
      }
      setHasLocation(true);
    }
    setFollowing(true);
  }, [hasLocation]);

  const downloadVisibleArea = useCallback(async () => {
    const bounds = await mapRef.current?.getBounds();
    if (!bounds) return;

    const tiles = estimateTiles(bounds);
    if (tiles > MAX_TILES_PER_PACK) {
      Alert.alert(
        'พื้นที่ใหญ่เกินไป',
        `พื้นที่ที่เลือกต้องใช้ประมาณ ${tiles.toLocaleString()} ไทล์ ` +
          `(สูงสุด ${MAX_TILES_PER_PACK.toLocaleString()}) กรุณาซูมเข้าให้เห็นพื้นที่เล็กลงแล้วลองใหม่`,
      );
      return;
    }

    if (!styleUri) return;
    const name = defaultName();
    setProgress(0);
    try {
      await OfflineManager.createPack(
        {
          mapStyle: styleUri,
          bounds,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          metadata: { name, createdAt: Date.now() },
        },
        (_pack, status) => {
          setProgress(status.percentage);
          if (status.state === 'complete') {
            setProgress(null);
            refreshAreas().catch(() => {});
            Alert.alert(
              'ดาวน์โหลดเสร็จแล้ว',
              `${name} (${formatMB(status.completedResourceSize)}) ใช้งานได้แม้ไม่มีสัญญาณ`,
            );
          }
        },
        (_pack, error) => {
          setProgress(null);
          Alert.alert('ดาวน์โหลดไม่สำเร็จ', error.message);
        },
      );
    } catch (e) {
      setProgress(null);
      Alert.alert('ดาวน์โหลดไม่สำเร็จ', String(e));
    }
  }, [refreshAreas, styleUri]);

  const deleteArea = useCallback(
    (area: SavedArea) => {
      Alert.alert('ลบแผนที่นี้?', area.name, [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: async () => {
            await OfflineManager.deletePack(area.id);
            refreshAreas().catch(() => {});
          },
        },
      ]);
    },
    [refreshAreas],
  );

  const showArea = useCallback((area: SavedArea) => {
    setFollowing(false);
    setListOpen(false);
    cameraRef.current?.fitBounds(area.bounds, { duration: 800 });
  }, []);

  const downloading = progress !== null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      {styleUri && (
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={styleUri}
        onPress={() => setFollowing(false)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: THAILAND_CENTER, zoom: 5 }}
          trackUserLocation={following ? 'default' : undefined}
          onTrackUserLocationChange={(e) =>
            setFollowing(e.nativeEvent.trackUserLocation !== null)
          }
        />
        {hasLocation && <UserLocation accuracy heading />}
      </Map>
      )}

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Pressable style={styles.chip} onPress={() => setListOpen(true)}>
          <Text style={styles.chipText}>แผนที่ที่ดาวน์โหลดไว้ ({areas.length})</Text>
        </Pressable>
        {altitude !== null && (
          <View style={[styles.chip, styles.altChip]}>
            <Text style={styles.chipText}>ความสูง (GPS) {Math.round(altitude)} ม.</Text>
          </View>
        )}
      </SafeAreaView>

      <SafeAreaView style={styles.bottomBar} pointerEvents="box-none">
        <Pressable
          style={[styles.roundBtn, following && styles.roundBtnActive]}
          onPress={goToMe}
          accessibilityLabel="ไปที่ตำแหน่งของฉัน"
        >
          <Text style={styles.roundBtnText}>◎</Text>
        </Pressable>

        <Pressable
          style={[styles.mainBtn, downloading && styles.mainBtnDisabled]}
          onPress={downloadVisibleArea}
          disabled={downloading}
        >
          {downloading ? (
            <View style={styles.row}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.mainBtnText}>
                {'  '}กำลังดาวน์โหลด {Math.round(progress ?? 0)}%
              </Text>
            </View>
          ) : (
            <Text style={styles.mainBtnText}>ดาวน์โหลดพื้นที่ที่เห็นบนจอ</Text>
          )}
        </Pressable>
      </SafeAreaView>

      <Modal
        visible={listOpen}
        animationType="slide"
        onRequestClose={() => setListOpen(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>แผนที่ที่ดาวน์โหลดไว้</Text>
            <Pressable onPress={() => setListOpen(false)}>
              <Text style={styles.close}>ปิด</Text>
            </Pressable>
          </View>
          <FlatList
            data={areas}
            keyExtractor={(a) => a.id}
            ListEmptyComponent={
              <Text style={styles.empty}>
                ยังไม่มีแผนที่ออฟไลน์{'\n'}เลื่อนแผนที่ไปยังพื้นที่ที่จะเดินป่า แล้วกด "ดาวน์โหลดพื้นที่ที่เห็นบนจอ"
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.item}>
                <Pressable style={styles.itemInfo} onPress={() => showArea(item)}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemSub}>
                    {item.status
                      ? item.status.state === 'complete'
                        ? `พร้อมใช้งาน · ${formatMB(item.status.completedResourceSize)}`
                        : `ยังไม่ครบ ${Math.round(item.status.percentage)}%`
                      : ''}
                  </Text>
                </Pressable>
                <Pressable onPress={() => deleteArea(item)}>
                  <Text style={styles.delete}>ลบ</Text>
                </Pressable>
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const GREEN = '#2e6b3f';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, padding: 12 },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  chipText: { fontSize: 15, color: '#222' },
  altChip: { marginTop: 8 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roundBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  roundBtnActive: { backgroundColor: '#d9efe0' },
  roundBtnText: { fontSize: 26, color: GREEN },
  mainBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  mainBtnDisabled: { backgroundColor: '#6f9a7b' },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center' },
  modal: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  close: { fontSize: 16, color: GREEN },
  empty: { padding: 24, textAlign: 'center', color: '#666', lineHeight: 24 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 16, fontWeight: '600' },
  itemSub: { fontSize: 13, color: '#666', marginTop: 2 },
  delete: { color: '#b3261e', fontSize: 15, padding: 8 },
});
