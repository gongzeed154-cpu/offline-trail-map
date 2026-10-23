import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
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
import TeamPanel from './TeamPanel';
import { getTeamState, resumeTeam, subscribeTeam, type TeamState } from './team';
import {
  deleteTrack,
  ensureTrackPermissions,
  exportTrackGPX,
  getActiveTrackId,
  listTracks,
  measure,
  readTrackPoints,
  renameTrack,
  startTrack,
  stopTrack,
  type TrackSummary,
} from './tracker';

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

function formatKm(m: number) {
  return m < 1000 ? `${Math.round(m)} ม.` : `${(m / 1000).toFixed(2)} กม.`;
}

function formatDuration(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
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
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [trackStart, setTrackStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [lineCoords, setLineCoords] = useState<[number, number][]>([]);
  const [liveDistance, setLiveDistance] = useState(0);
  const [team, setTeam] = useState<TeamState>(getTeamState());
  const [teamOpen, setTeamOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeTeam(setTeam);
    resumeTeam().catch(() => {});
    return unsub;
  }, []);

  // กันหน้าจอดับระหว่างดาวน์โหลด
  useKeepAwake();

  const refreshTracks = useCallback(() => {
    try {
      setTracks(listTracks());
    } catch (e) {
      Alert.alert('อ่านรายการเส้นทางไม่ได้', String(e));
    }
  }, []);

  // กลับเข้าแอพแล้วดูว่ายังบันทึกค้างอยู่ไหม (แอพอาจถูกปิดไประหว่างบันทึก)
  useEffect(() => {
    try {
      const id = getActiveTrackId();
      setActiveTrackId(id);
      if (id) {
        const t = listTracks().find((x) => x.id === id);
        setTrackStart(t?.startedAt ?? Date.now());
      }
      refreshTracks();
    } catch {
      // ยังไม่เคยบันทึก
    }
  }, [refreshTracks]);

  // ระหว่างบันทึก: ทุก 5 วินาทีอ่านจุดที่งานเบื้องหลังเขียนไว้ มาวาดเส้นบนแผนที่
  useEffect(() => {
    if (!activeTrackId) return;
    const tick = () => {
      setNow(Date.now());
      try {
        const pts = readTrackPoints(activeTrackId);
        setLineCoords(pts.map((p) => [p.lng, p.lat]));
        setLiveDistance(measure(pts).distanceM);
      } catch {
        // อ่านไม่ทันตอนกำลังเขียน ลองใหม่รอบหน้า
      }
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [activeTrackId]);

  const toggleRecording = useCallback(async () => {
    try {
      if (activeTrackId) {
        await stopTrack();
        setActiveTrackId(null);
        setTrackStart(null);
        refreshTracks();
        Alert.alert('บันทึกการเดินทางแล้ว', 'ดูและส่งออกไฟล์ได้ที่ "การเดินทางที่บันทึกไว้"');
        return;
      }
      const perm = await ensureTrackPermissions();
      if (perm === 'denied') {
        Alert.alert('ยังไม่ได้อนุญาตตำแหน่ง', 'กรุณาเปิดสิทธิ์ตำแหน่งในการตั้งค่าเครื่อง แล้วลองใหม่');
        return;
      }
      if (perm === 'foreground-only') {
        Alert.alert(
          'บันทึกตอนล็อคจอไม่ได้',
          'ต้องเลือกอนุญาตตำแหน่ง "ตลอดเวลา" ในการตั้งค่าเครื่อง ตอนนี้จะบันทึกได้เฉพาะตอนเปิดแอพค้างไว้',
        );
      }
      const id = await startTrack();
      setLineCoords([]);
      setLiveDistance(0);
      setTrackStart(Date.now());
      setActiveTrackId(id);
    } catch (e) {
      Alert.alert('บันทึกการเดินทางไม่ได้', String(e));
    }
  }, [activeTrackId, refreshTracks]);

  const showTrack = useCallback((t: TrackSummary) => {
    const pts = readTrackPoints(t.id);
    if (pts.length === 0) {
      Alert.alert('เส้นทางนี้ยังไม่มีจุดบันทึก');
      return;
    }
    setLineCoords(pts.map((p) => [p.lng, p.lat]));
    setFollowing(false);
    setTracksOpen(false);
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    cameraRef.current?.fitBounds(
      [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      { duration: 800, padding: { top: 120, bottom: 160, left: 40, right: 40 } },
    );
  }, []);

  const exportTrack = useCallback(async (t: TrackSummary) => {
    try {
      await exportTrackGPX(t.id);
    } catch (e) {
      Alert.alert('ส่งออกไม่สำเร็จ', String(e));
    }
  }, []);

  const removeTrack = useCallback(
    (t: TrackSummary) => {
      Alert.alert('ลบการเดินทางนี้?', t.name, [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: () => {
            deleteTrack(t.id);
            refreshTracks();
          },
        },
      ]);
    },
    [refreshTracks],
  );

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
        {lineCoords.length > 1 && (
          <GeoJSONSource
            id="track-src"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: lineCoords },
            }}
          >
            <Layer
              id="track-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#d6261c', 'line-width': 5 }}
            />
          </GeoJSONSource>
        )}
        {team.route && team.route.length > 1 && (
          <GeoJSONSource
            id="team-route-src"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: team.route },
            }}
          >
            <Layer
              id="team-route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#1a5fd0', 'line-width': 5, 'line-opacity': 0.8, 'line-dasharray': [2, 1.5] }}
            />
          </GeoJSONSource>
        )}
        {team.status !== 'off' && (
          <GeoJSONSource
            id="team-members-src"
            data={{
              type: 'FeatureCollection',
              features: team.members
                .filter((m) => m.pos && m.id !== team.you)
                .map((m) => ({
                  type: 'Feature' as const,
                  properties: { name: m.name, color: m.color, online: m.online ? 1 : 0 },
                  geometry: { type: 'Point' as const, coordinates: [m.pos!.lng, m.pos!.lat] },
                })),
            }}
          >
            <Layer
              id="team-members-dot"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': ['get', 'color'],
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 3,
                'circle-opacity': ['case', ['==', ['get', 'online'], 1], 1, 0.45],
              }}
            />
            <Layer
              id="team-members-label"
              type="symbol"
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Bold'],
                'text-size': 13,
                'text-offset': [0, 1.4],
                'text-allow-overlap': true,
              }}
              paint={{ 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 2 }}
            />
          </GeoJSONSource>
        )}
        {hasLocation && <UserLocation accuracy heading />}
      </Map>
      )}

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Pressable style={styles.chip} onPress={() => setListOpen(true)}>
          <Text style={styles.chipText}>แผนที่ที่ดาวน์โหลดไว้ ({areas.length})</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, styles.altChip]}
          onPress={() => {
            refreshTracks();
            setTracksOpen(true);
          }}
        >
          <Text style={styles.chipText}>การเดินทางที่บันทึกไว้ ({tracks.length})</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, styles.altChip, team.status !== 'off' && styles.teamChip]}
          onPress={() => {
            refreshTracks();
            setTeamOpen(true);
          }}
        >
          <Text style={styles.chipText}>
            {team.status === 'off'
              ? 'ทีมเดินป่า'
              : `ทีม ${team.code} · ${team.members.filter((m) => m.online).length}/${team.members.length} ออนไลน์${
                  team.status === 'online' ? '' : ' (กำลังเชื่อมต่อ)'
                }`}
          </Text>
        </Pressable>
        {activeTrackId && trackStart !== null && (
          <View style={[styles.chip, styles.altChip, styles.recChip]}>
            <Text style={styles.chipText}>
              ● กำลังบันทึก {formatDuration(now - trackStart)} · {formatKm(liveDistance)}
            </Text>
          </View>
        )}
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
          style={[styles.roundBtn, activeTrackId && styles.recBtnActive]}
          onPress={toggleRecording}
          accessibilityLabel={activeTrackId ? 'หยุดบันทึกการเดินทาง' : 'เริ่มบันทึกการเดินทาง'}
        >
          <Text style={[styles.roundBtnText, styles.recDot, activeTrackId && styles.recDotActive]}>
            {activeTrackId ? '■' : '●'}
          </Text>
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

      <TeamPanel visible={teamOpen} onClose={() => setTeamOpen(false)} team={team} tracks={tracks} />

      <Modal
        visible={tracksOpen}
        animationType="slide"
        onRequestClose={() => setTracksOpen(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>การเดินทางที่บันทึกไว้</Text>
            <Pressable onPress={() => setTracksOpen(false)}>
              <Text style={styles.close}>ปิด</Text>
            </Pressable>
          </View>
          <FlatList
            data={tracks}
            keyExtractor={(t) => t.id}
            ListEmptyComponent={
              <Text style={styles.empty}>
                ยังไม่มีการเดินทางที่บันทึกไว้{'\n'}กดปุ่ม ● ที่มุมล่างเพื่อเริ่มบันทึก แอพจะเก็บเส้นทางต่อเนื่องแม้ล็อคหน้าจอ
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.item}>
                <Pressable style={styles.itemInfo} onPress={() => showTrack(item)}>
                  <Text style={styles.itemName}>
                    {item.active ? '● ' : ''}
                    {item.name}
                  </Text>
                  <Text style={styles.itemSub}>
                    {formatKm(item.distanceM)} · ขึ้น {Math.round(item.ascentM)} ม. ·{' '}
                    {item.endedAt ? formatDuration(item.endedAt - item.startedAt) : 'กำลังบันทึก'} ·{' '}
                    {item.points} จุด
                  </Text>
                </Pressable>
                {Platform.OS === 'ios' && (
                  <Pressable
                    onPress={() =>
                      Alert.prompt('เปลี่ยนชื่อ', undefined, (name) => {
                        renameTrack(item.id, name ?? '');
                        refreshTracks();
                      }, 'plain-text', item.name)
                    }
                  >
                    <Text style={styles.action}>ชื่อ</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => exportTrack(item)} disabled={item.active}>
                  <Text style={[styles.action, item.active && styles.actionOff]}>ส่งออก</Text>
                </Pressable>
                <Pressable onPress={() => removeTrack(item)} disabled={item.active}>
                  <Text style={[styles.delete, item.active && styles.actionOff]}>ลบ</Text>
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
  teamChip: { backgroundColor: '#dde9ff' },
  recChip: { backgroundColor: '#ffe3e0' },
  recBtnActive: { backgroundColor: '#d6261c' },
  recDot: { color: '#d6261c', fontSize: 22 },
  recDotActive: { color: '#fff', fontSize: 20 },
  action: { color: GREEN, fontSize: 15, padding: 8 },
  actionOff: { opacity: 0.35 },
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
