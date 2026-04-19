import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#111827',
    lineHeight: 1.4,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 4,
    color: '#111827',
  },
  subtitle: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 14,
  },
  overviewHeader: {
    fontSize: 11,
    fontWeight: 700,
    color: '#0e7490',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  overviewMap: {
    width: '100%',
    height: 300,
    marginBottom: 18,
    objectFit: 'contain',
    borderRadius: 6,
  },
  dayHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0e7490',
    borderBottomWidth: 2,
    borderBottomColor: '#0891b2',
    paddingBottom: 4,
    marginTop: 10,
    marginBottom: 10,
  },
  activity: {
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  lodging: {
    borderLeftColor: '#d97706',
    backgroundColor: '#fef3c7',
  },
  activityTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 3,
    color: '#111827',
  },
  activityMeta: {
    fontSize: 9,
    color: '#6B7280',
    marginBottom: 2,
  },
  activityNotes: {
    fontSize: 10,
    marginTop: 5,
    lineHeight: 1.45,
    color: '#374151',
  },
  route: {
    marginVertical: 6,
    padding: 8,
    backgroundColor: '#ecfeff',
    borderWidth: 1,
    borderColor: '#a5f3fc',
    borderRadius: 6,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  routeText: {
    fontSize: 10,
    fontWeight: 700,
    color: '#0e7490',
    flex: 1,
  },
  routeTime: {
    fontSize: 10,
    color: '#0e7490',
    fontWeight: 700,
  },
  routeMap: {
    width: '100%',
    height: 160,
    borderRadius: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});

function formatDay(dateKey) {
  if (!dateKey || dateKey === 'Unscheduled') return 'Unscheduled';
  const d = new Date(dateKey + 'T00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(time) {
  if (!time) return '';
  return new Date('2000-01-01T' + time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatEventDate(event) {
  const d = event?.date?.toDate ? event.date.toDate() : event?.date ? new Date(event.date) : null;
  const ed = event?.endDate?.toDate ? event.endDate.toDate() : event?.endDate ? new Date(event.endDate) : null;
  if (!d) return '';
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (!ed || ed.toDateString() === d.toDateString()) return dateStr;
  const endStr = ed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `${dateStr} – ${endStr}`;
}

const MODE_EMOJI = {
  driving: 'Drive',
  walking: 'Walk',
  bicycling: 'Bike',
  transit: 'Transit',
  flying: 'Flight',
};

export function ItineraryPDF({
  event,
  items,
  overviewMapUrl,
  routeMapsByFromId, // fromItemId -> { url, mode, toTitle, duration }
}) {
  const groups = {};
  for (const item of items) {
    const key = item.date || 'Unscheduled';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => {
    if (a === 'Unscheduled') return 1;
    if (b === 'Unscheduled') return -1;
    return a.localeCompare(b);
  });

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{event?.title || 'Trip Itinerary'}</Text>
        {formatEventDate(event) && (
          <Text style={styles.subtitle}>{formatEventDate(event)}</Text>
        )}

        {overviewMapUrl && (
          <View wrap={false}>
            <Text style={styles.overviewHeader}>Trip Route Overview</Text>
            <Image src={overviewMapUrl} style={styles.overviewMap} />
          </View>
        )}

        {sortedDates.map(dateKey => {
          const dateItems = groups[dateKey]
            .slice()
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
          const activityItems = dateItems.filter(i => (i.type || 'activity') === 'activity');
          const lodgingItems = dateItems.filter(i => (i.type || 'activity') === 'lodging');

          return (
            <View key={dateKey}>
              <Text style={styles.dayHeader} wrap={false}>{formatDay(dateKey)}</Text>

              {activityItems.map((item, i) => {
                const nextRoute = routeMapsByFromId[item.id];
                return (
                  <View key={item.id} wrap={false}>
                    <View style={styles.activity}>
                      <Text style={styles.activityTitle}>{item.title}</Text>
                      {item.time && <Text style={styles.activityMeta}>{formatTime(item.time)}</Text>}
                      {item.location && <Text style={styles.activityMeta}>📍 {item.location}</Text>}
                      {item.notes && <Text style={styles.activityNotes}>{item.notes}</Text>}
                    </View>
                    {nextRoute && (
                      <View style={styles.route}>
                        <View style={styles.routeRow}>
                          <Text style={styles.routeText}>
                            {MODE_EMOJI[nextRoute.mode] || 'Drive'} to {nextRoute.toTitle}
                          </Text>
                          {nextRoute.duration && (
                            <Text style={styles.routeTime}>{nextRoute.duration}</Text>
                          )}
                        </View>
                        {nextRoute.url && <Image src={nextRoute.url} style={styles.routeMap} />}
                      </View>
                    )}
                  </View>
                );
              })}

              {lodgingItems.length > 0 && (
                <View wrap={false}>
                  {lodgingItems.map(item => (
                    <View key={item.id} style={[styles.activity, styles.lodging]}>
                      <Text style={styles.activityTitle}>🏨 {item.title}</Text>
                      {item.location && <Text style={styles.activityMeta}>📍 {item.location}</Text>}
                      {item.notes && <Text style={styles.activityNotes}>{item.notes}</Text>}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Rally • Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
