import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  MAX_MEMBERS,
  MAX_NAME,
  TEAM_COLORS,
  createTeam,
  disbandTeam,
  joinTeam,
  leaveTeam,
  readServerUrlDefault,
  shareRoute,
  validateName,
  type TeamState,
} from './team';
import { readTrackPoints, type TrackSummary } from './tracker';

const GREEN = '#2e6b3f';

type Props = {
  visible: boolean;
  onClose: () => void;
  team: TeamState;
  tracks: TrackSummary[];
};

function routeOf(trackId: string): [number, number][] {
  const pts = readTrackPoints(trackId);
  // ลดจำนวนจุดให้ไม่เกิน ~2000 จุด ก่อนส่งให้ทีม
  const step = Math.max(1, Math.ceil(pts.length / 2000));
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i += step) out.push([pts[i].lng, pts[i].lat]);
  const last = pts[pts.length - 1];
  if (last && out[out.length - 1]?.[0] !== last.lng) out.push([last.lng, last.lat]);
  return out;
}

function ColorPicker({ value, onChange, taken }: { value: string; onChange: (c: string) => void; taken: string[] }) {
  return (
    <View style={s.colors}>
      {TEAM_COLORS.map((c) => {
        const used = taken.includes(c);
        return (
          <Pressable
            key={c}
            disabled={used}
            onPress={() => onChange(c)}
            accessibilityLabel={`สี ${c}`}
            style={[s.swatch, { backgroundColor: c }, value === c && s.swatchOn, used && s.swatchUsed]}
          />
        );
      })}
    </View>
  );
}

export default function TeamPanel({ visible, onClose, team, tracks }: Props) {
  const [serverUrl, setServerUrl] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [routeTrackId, setRouteTrackId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changeRoute, setChangeRoute] = useState(false);

  useEffect(() => {
    try {
      setServerUrl(readServerUrlDefault());
    } catch {
      // ยังไม่เคยตั้งค่า
    }
  }, []);

  const inTeam = team.status !== 'off';
  const me = team.members.find((m) => m.id === team.you);
  const isHost = !!me?.host;
  const doneTracks = tracks.filter((t) => !t.active && t.points > 1);
  const taken = team.members.map((m) => m.color);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const bad = validateName(name);
    if (bad) return Alert.alert(bad);
    if (mode === 'create') {
      if (!routeTrackId) return Alert.alert('เลือกเส้นทางก่อน', 'หัวหน้าทีมต้องเลือกเส้นทางที่จะแชร์ให้ทีม');
      return run(() => createTeam({ serverUrl, name: name.trim(), color, route: routeOf(routeTrackId) }));
    }
    if (code.trim().length < 4) return Alert.alert('กรุณาใส่รหัสทีมที่ได้จากหัวหน้า');
    return run(() => joinTeam({ serverUrl, code, name: name.trim(), color }));
  };

  const confirmExit = () =>
    Alert.alert(isHost ? 'ออกจากทีม?' : 'ออกจากทีมนี้?', isHost ? 'หัวหน้าทีมออก สิทธิ์จะโอนให้คนถัดไป หรือยุบทีมทั้งหมดก็ได้' : undefined, [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ออก', onPress: () => void leaveTeam() },
      ...(isHost ? [{ text: 'ยุบทีม', style: 'destructive' as const, onPress: () => void disbandTeam() }] : []),
    ]);

  const trackPicker = (onPick: (id: string) => void, selected: string | null) => (
    <View>
      {doneTracks.length === 0 && (
        <Text style={s.hint}>ยังไม่มีเส้นทาง บันทึกการเดินทาง (ปุ่ม ● บนแผนที่) หรือเดินสำรวจไว้ก่อน แล้วกลับมาสร้างทีม</Text>
      )}
      {doneTracks.map((t) => (
        <Pressable key={t.id} style={[s.pick, selected === t.id && s.pickOn]} onPress={() => onPick(t.id)}>
          <Text style={s.pickName}>{t.name}</Text>
          <Text style={s.hint}>{(t.distanceM / 1000).toFixed(2)} กม. · {t.points} จุด</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.modal}>
        <View style={s.header}>
          <Text style={s.title}>ทีมเดินป่า</Text>
          <Pressable onPress={onClose}>
            <Text style={s.close}>ปิด</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {inTeam ? (
            <>
              <Text style={s.label}>รหัสทีม (ให้เพื่อนใส่เพื่อเข้าทีม)</Text>
              <Text style={s.code} selectable>{team.code}</Text>
              <Text style={s.hint}>
                {team.status === 'online' ? 'เชื่อมต่อแล้ว' : 'สัญญาณหลุด กำลังเชื่อมต่อใหม่...'} · {team.members.length}/{MAX_MEMBERS} เครื่อง
              </Text>
              {team.error && <Text style={s.err}>{team.error}</Text>}

              <Text style={[s.label, s.gap]}>สมาชิก</Text>
              {team.members.map((m) => (
                <View key={m.id} style={s.member}>
                  <View style={[s.dot, { backgroundColor: m.color }]} />
                  <Text style={s.memberName}>
                    {m.name}
                    {m.host ? ' (หัวหน้า)' : ''}
                    {m.id === team.you ? ' (คุณ)' : ''}
                  </Text>
                  <Text style={m.online ? s.on : s.off}>{m.online ? 'ออนไลน์' : 'ออฟไลน์'}</Text>
                </View>
              ))}

              {isHost && (
                <>
                  <Text style={[s.label, s.gap]}>เส้นทางของทีม</Text>
                  <Pressable style={s.btnAlt} onPress={() => setChangeRoute((v) => !v)}>
                    <Text style={s.btnAltText}>{changeRoute ? 'ยกเลิกการเปลี่ยน' : 'เปลี่ยนเส้นทางที่แชร์'}</Text>
                  </Pressable>
                  {changeRoute &&
                    trackPicker((id) => {
                      shareRoute(routeOf(id));
                      setChangeRoute(false);
                      Alert.alert('แชร์เส้นทางใหม่ให้ทีมแล้ว');
                    }, null)}
                </>
              )}

              <Pressable style={[s.btnAlt, s.gap]} onPress={confirmExit}>
                <Text style={[s.btnAltText, { color: '#b3261e' }]}>ออกจากทีม</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.tabs}>
                <Pressable style={[s.tab, mode === 'create' && s.tabOn]} onPress={() => setMode('create')}>
                  <Text style={[s.tabText, mode === 'create' && s.tabTextOn]}>สร้างทีม</Text>
                </Pressable>
                <Pressable style={[s.tab, mode === 'join' && s.tabOn]} onPress={() => setMode('join')}>
                  <Text style={[s.tabText, mode === 'join' && s.tabTextOn]}>เข้าร่วมทีม</Text>
                </Pressable>
              </View>

              <Text style={s.label}>ที่อยู่เซิร์ฟเวอร์ทีม</Text>
              <TextInput
                style={s.input}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="wss://team.example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {mode === 'join' && (
                <>
                  <Text style={s.label}>รหัสทีม (6 ตัว จากหัวหน้า)</Text>
                  <TextInput
                    style={[s.input, s.codeInput]}
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    maxLength={6}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </>
              )}

              <Text style={s.label}>ชื่อของคุณ (ไม่เกิน {MAX_NAME} ตัวอักษร)</Text>
              <TextInput style={s.input} value={name} onChangeText={setName} maxLength={MAX_NAME} placeholder="เช่น น้องฟ้า" />
              <Text style={s.hint}>{[...name].length}/{MAX_NAME}</Text>

              <Text style={s.label}>สีของคุณบนแผนที่ (แต่ละคนในทีมไม่ซ้ำกัน)</Text>
              <ColorPicker value={color} onChange={setColor} taken={[]} />

              {mode === 'create' && (
                <>
                  <Text style={[s.label, s.gap]}>เลือกเส้นทางที่จะแชร์ให้ทีม</Text>
                  {trackPicker(setRouteTrackId, routeTrackId)}
                </>
              )}

              <Pressable style={[s.btn, busy && s.btnOff]} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{mode === 'create' ? 'สร้างทีม' : 'เข้าร่วมทีม'}</Text>}
              </Pressable>
              <Text style={s.hint}>
                ต้องมีอินเทอร์เน็ต/สัญญาณมือถือเพื่อเห็นตำแหน่งเพื่อน ถ้าไม่มีสัญญาณ แผนที่และ GPS ของเครื่องคุณยังใช้ได้ปกติ และเมื่อสัญญาณกลับมาจะเชื่อมต่อทีมให้เอง
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  title: { fontSize: 18, fontWeight: '700' },
  close: { fontSize: 16, color: GREEN },
  body: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 14, color: '#444', marginTop: 14, marginBottom: 6, fontWeight: '600' },
  gap: { marginTop: 22 },
  hint: { fontSize: 13, color: '#666', marginTop: 4, lineHeight: 19 },
  err: { color: '#b3261e', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 10, padding: 12, fontSize: 16 },
  codeInput: { letterSpacing: 6, fontSize: 22, textAlign: 'center' },
  code: { fontSize: 36, fontWeight: '800', letterSpacing: 8, color: GREEN, textAlign: 'center', paddingVertical: 8 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#bbb', alignItems: 'center' },
  tabOn: { backgroundColor: GREEN, borderColor: GREEN },
  tabText: { fontSize: 15, color: '#333' },
  tabTextOn: { color: '#fff', fontWeight: '700' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#fff', elevation: 2 },
  swatchOn: { borderColor: '#000', borderWidth: 4 },
  swatchUsed: { opacity: 0.15 },
  pick: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, marginTop: 8 },
  pickOn: { borderColor: GREEN, borderWidth: 2, backgroundColor: '#eef6f0' },
  pickName: { fontSize: 15, fontWeight: '600' },
  btn: { marginTop: 24, backgroundColor: GREEN, borderRadius: 26, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnOff: { backgroundColor: '#6f9a7b' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnAlt: { marginTop: 8, borderWidth: 1, borderColor: '#bbb', borderRadius: 26, height: 46, alignItems: 'center', justifyContent: 'center' },
  btnAltText: { fontSize: 15, color: GREEN, fontWeight: '600' },
  member: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#fff', elevation: 2 },
  memberName: { flex: 1, fontSize: 16 },
  on: { color: GREEN, fontSize: 13 },
  off: { color: '#999', fontSize: 13 },
});
